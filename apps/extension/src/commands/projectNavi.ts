import * as vscode from 'vscode';
import {
    Phase,
    Project,
    ProjectNaviStore,
    TaskItem,
    newPhaseId,
    newTaskId,
    progressOf
} from '../storage/projectNavi';
import { ProjectNaviNode } from '../providers/projectNaviProvider';
import { ApiKeyStore } from '../storage/apiKey';
import { TokenTrackerStore, normalizeQuestion } from '../storage/tokenTracker';
import { LLMError, NoApiKeyError, trackedAskLLM } from '../utils/llm';
import {
    RoadmapPhaseSpec,
    buildRoadmapMessages,
    buildTaskHintMessages,
    parseRoadmap
} from '../utils/prompts';

// 프로젝트 네비 UX — 생성/삭제/토글/힌트
export class ProjectNaviActions {
    constructor(
        private readonly store: ProjectNaviStore,
        private readonly keys: ApiKeyStore,
        private readonly tracker: TokenTrackerStore,
        private readonly onChange: () => void
    ) {}

    // 새 프로젝트 — 이름 + 목표 → AI 로드맵 생성 → 저장
    async addProject(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: '프로젝트 이름 (1/2)',
            placeHolder: '예: 할일 관리 앱',
            validateInput: (v) => (v.trim() ? null : '이름을 입력하세요')
        });
        if (!name) { return; }

        const goal = await vscode.window.showInputBox({
            prompt: '어떤 프로젝트 만들 거야? 한 줄로 (2/2)',
            placeHolder: '예: React + localStorage로 할일 CRUD 앱',
            validateInput: (v) => (v.trim() ? null : '목표를 입력하세요')
        });
        if (!goal) { return; }

        const specs = await this.generateRoadmap(goal);
        if (!specs) { return; }

        const phases: Phase[] = specs.map((s) => ({
            id: newPhaseId(),
            name: s.name,
            tasks: s.tasks.map<TaskItem>((t) => ({ id: newTaskId(), name: t, done: false }))
        }));

        await this.store.add({ name: name.trim(), goal: goal.trim(), phases });
        this.onChange();
        vscode.window.setStatusBarMessage(`$(rocket) "${name}" 시작! ${phases.length} Phase`, 2500);
    }

    // 프로젝트 삭제
    async removeProject(node: ProjectNaviNode): Promise<void> {
        if (!node.project) { return; }

        const confirm = await vscode.window.showWarningMessage(
            `"${node.project.name}" 프로젝트를 삭제할까요? (진행 기록도 사라짐)`,
            { modal: true },
            '삭제'
        );
        if (confirm !== '삭제') { return; }

        await this.store.remove(node.project.id);
        this.onChange();
    }

    // 태스크 체크/해제 — 진행률 업데이트 + 축하 메시지
    async toggleTask(node: ProjectNaviNode): Promise<void> {
        if (!node.project || !node.phase || !node.task) { return; }

        await this.store.toggleTask(node.project.id, node.phase.id, node.task.id);
        this.onChange();

        // 최신 상태 재조회 → Phase 완료, 프로젝트 완료 감지
        const updated = this.store.get(node.project.id);
        if (!updated) { return; }

        const phase = updated.phases.find((p) => p.id === node.phase!.id);
        if (phase && phase.tasks.every((t) => t.done) && phase.tasks.length > 0) {
            vscode.window.showInformationMessage(`🎉 한 단계 끝! ${phase.name}`);
        }

        const { done, total } = progressOf(updated);
        if (total > 0 && done === total) {
            vscode.window.showInformationMessage(`🏁 "${updated.name}" 전체 완료! 수고했어.`);
        }
    }

    // 태스크 힌트 — 캐시 있으면 재사용(토큰 0원), 없으면 AI 호출
    async showHint(node: ProjectNaviNode): Promise<void> {
        if (!node.project || !node.phase || !node.task) { return; }

        if (node.task.hint) {
            // 캐시 히트 — 토큰 0원. 조용히 기록.
            void this.tracker.record({
                provider: 'claude',
                model: 'cache',
                feature: 'projectNavi.hint',
                question: normalizeQuestion(node.task.name),
                promptChars: 0,
                responseChars: node.task.hint.length,
                cached: true
            });
            this.openHintPreview(node.project, node.phase, node.task, node.task.hint, true);
            return;
        }

        try {
            const answer = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: '힌트 요청 중…' },
                () => trackedAskLLM(
                    this.keys,
                    this.tracker,
                    'projectNavi.hint',
                    node.task!.name,
                    buildTaskHintMessages(node.project!.goal, node.phase!.name, node.task!.name)
                )
            );

            await this.store.setTaskHint(node.project.id, node.phase.id, node.task.id, answer);
            this.onChange();
            this.openHintPreview(node.project, node.phase, node.task, answer, false);
        } catch (err) {
            this.handleAIError(err);
        }
    }

    // 목표 → AI 로드맵 파싱. 실패하면 기본 템플릿으로 fallback 여부 물음
    private async generateRoadmap(goal: string): Promise<RoadmapPhaseSpec[] | undefined> {
        try {
            const raw = await vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: '부트캠프 로드맵 생성 중…' },
                () => trackedAskLLM(
                    this.keys,
                    this.tracker,
                    'projectNavi.roadmap',
                    goal,
                    buildRoadmapMessages(goal)
                )
            );

            const specs = parseRoadmap(raw);
            if (specs.length === 0) {
                throw new Error('AI 응답에서 Phase를 추출하지 못했어.');
            }
            return specs;
        } catch (err) {
            if (err instanceof NoApiKeyError) {
                const pick = await vscode.window.showWarningMessage(
                    `${err.message}\n\n기본 템플릿으로 시작할까?`,
                    '기본 템플릿',
                    'API 키 설정'
                );
                if (pick === '기본 템플릿') { return FALLBACK_ROADMAP; }
                if (pick === 'API 키 설정') {
                    await vscode.commands.executeCommand('devnavi.config.setApiKey');
                }
                return undefined;
            }

            const msg = err instanceof LLMError || err instanceof Error ? err.message : String(err);
            const pick = await vscode.window.showErrorMessage(
                `로드맵 생성 실패 — ${msg}`,
                '기본 템플릿',
                '취소'
            );
            return pick === '기본 템플릿' ? FALLBACK_ROADMAP : undefined;
        }
    }

    private handleAIError(err: unknown): void {
        if (err instanceof NoApiKeyError) {
            vscode.window.showWarningMessage(err.message, 'API 키 설정').then((pick) => {
                if (pick === 'API 키 설정') {
                    vscode.commands.executeCommand('devnavi.config.setApiKey');
                }
            });
            return;
        }
        const msg = err instanceof LLMError || err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`힌트 요청 실패 — ${msg}`);
    }

    // 힌트를 마크다운 프리뷰로 열기 — webview 없이 네이티브 탭
    private openHintPreview(
        project: Project,
        phase: Phase,
        task: TaskItem,
        body: string,
        cached: boolean
    ): void {
        const lines = [
            `# 💡 ${task.name}`,
            '',
            `_${project.name} · ${phase.name}${cached ? ' · (캐시된 힌트)' : ''}_`,
            '',
            body,
            '',
            '---',
            '',
            '> 답이 아니라 **방향**이야. 직접 써보고 막히면 다시 물어봐.'
        ].join('\n');

        const uri = vscode.Uri.parse(
            `devnavi-navi:${encodeURIComponent(task.id)}.md`
        );
        ProjectNaviHintContent.instance.put(uri, lines);
        vscode.commands.executeCommand('markdown.showPreview', uri);
    }
}

// 힌트 프리뷰용 가상 문서 — 싱글톤으로 간단히 운영
export class ProjectNaviHintContent implements vscode.TextDocumentContentProvider {
    static readonly instance = new ProjectNaviHintContent();
    static readonly SCHEME = 'devnavi-navi';

    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;
    private readonly store = new Map<string, string>();

    put(uri: vscode.Uri, body: string): void {
        this.store.set(uri.toString(), body);
        this._onDidChange.fire(uri);
    }

    provideTextDocumentContent(uri: vscode.Uri): string {
        return this.store.get(uri.toString()) ?? '_힌트를 찾지 못했어._';
    }
}

// API 키 없을 때 즉시 시작할 수 있는 범용 템플릿
const FALLBACK_ROADMAP: RoadmapPhaseSpec[] = [
    {
        name: '1단계: 준비하기',
        tasks: [
            '무엇으로 만들지 정하기 (언어·도구)',
            '새 프로젝트 만들기',
            '파일을 넣을 폴더 정리하기',
            'Git 기록 시작하고 첫 저장(커밋)하기'
        ]
    },
    {
        name: '2단계: 가장 중요한 기능 만들기',
        tasks: [
            '가장 중요한 화면 하나 그리기',
            '어떤 정보를 저장할지 정하기',
            '가장 중요한 동작 하나 만들기',
            '직접 눌러 보며 확인하기'
        ]
    },
    {
        name: '3단계: 기억하고 저장하기',
        tasks: [
            '바뀌는 값을 어디에 둘지 정하기',
            '껐다 켜도 남도록 저장하기 (localStorage 등)',
            '오류가 나거나 비어 있을 때 보여 줄 화면 만들기'
        ]
    },
    {
        name: '4단계: 마무리하기',
        tasks: [
            '보기 좋게 꾸미기',
            '사용 설명서(README) 쓰기',
            '인터넷에 올리거나 친구에게 보여 주기'
        ]
    }
];
