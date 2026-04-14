# DevNavi

> **AI 시대 신입 개발자를 위한 조수석 네비게이터**
>
> Copilot이 짜주는 코드, 그게 뭔지는 알아야 하잖아.

---

## 왜 만들었나

AI(Copilot·Cursor·Claude·GPT)가 코드를 뚝딱 만들어주는 시대.
편하긴 한데 부작용이 생겼다.

- 작은 것도 직접 수정 못하는 개발자가 늘고 있다
- "이게 어디 있지?" "이 명령어 뭐였지?" 매번 구글링
- AI 의존도만 높아지고 실력은 정체

**AI가 대신 해주는 건 많은데, "내가 뭘 하고 있는지" 모르는 개발자가 늘고 있다.**

DevNavi는 AI를 대체하지 않는다. Copilot/Cursor와 **공존**한다.
AI가 코드를 짜주면, DevNavi가 "이게 이런 거야" 알려주고, 작은 건 직접 수정할 수 있게 가이드한다.

## 핵심 철학

**"대신 해주는 게 아니라, 할 수 있게 해주는 것"**

- 답을 주지 않고 **힌트**를 준다
- 화려한 UI 대신 **VSCode에 원래 있던 기능처럼** 자연스럽게
- 토큰 절약은 **조용히** 일어난다 — 평소엔 안 보이고, 궁금할 때만 열어봄

---

## 기능

### 🧭 치트시트 (로컬, 토큰 0원)

`git`, 터미널, `npm`, 단축키 — 자주 쓰는 명령어를 카테고리별로 펼쳐본다.
클릭 한 번으로 터미널에 바로 전송 or 클립보드 복사.

- 각 명령어마다 **"이게 뭐야 / 언제 써 / 예시"** 3줄 설명
- 커스텀 명령어 추가/수정/삭제 — 내 명령어 세트 만들기
- 빠른 검색 (`Ctrl+P`처럼)
- 기본 데이터는 로컬 JSON — API 호출 없음

### 📖 개발자 용어 사전

`lazy loading`, `hoisting`, 판교어까지 — 모르는 단어를 에디터에서 바로 조회.

- **❌ 일반 방식 / ✅ 이 용어 / 💡 예시** 포맷으로 통일
- 로컬 사전 우선 → 없으면 AI가 같은 포맷으로 설명
- 에디터에서 단어 선택 후 `Ctrl+Alt+W`
- 커스텀 용어 추가 가능

### 🗺️ 프로젝트 네비게이터 (부트캠프 멘토 모드)

"어떤 프로젝트 만들 거야?" 한 줄 → AI가 **Phase별 체크리스트**를 자동 생성.

```
📁 할일 관리 앱
  ✅ Phase 1: 프로젝트 세팅
    ✅ create-next-app 실행
    ✅ 폴더 구조 잡기
  🔲 Phase 2: 핵심 기능 뼈대
    🔲 할일 입력 컴포넌트
    🔲 상태 관리 결정
  ...
```

- 태스크 클릭 → **힌트만** 제공 (답 통째로 안 줌)
- 받은 힌트는 캐시 — 같은 걸 다시 물어봐도 토큰 0원
- Phase 완료 · 전체 완료 시 축하 메시지로 성취감
- API 키 없으면 기본 템플릿으로 시작 가능

### 💬 코드 가이드 (인라인 Comments API)

코드 선택 → 우클릭 또는 `Ctrl+Alt+Q` → DevNavi가 **코드 옆에 인라인 스레드**로 설명.

- 별도 창 없음, VSCode 네이티브 Comments API 사용
- **💡 힌트 모드** — 답 안 주고 방향만 (`Ctrl+Alt+H`)
- 스레드 답글로 후속 질문 가능 (히스토리 누적)
- Ctrl+. Code Action에도 "DevNavi: 이게 뭐야?" 노출

### 🪙 토큰 절약 시스템 (조용한 백그라운드)

> "절약은 조용히 일어나야 한다" — 화려한 대시보드가 아님.

상태바에 작은 아이콘: `🪙 절약 3회` 정도. 안 눌러도 됨.

클릭하면 **건강검진 리포트**:

- 오늘/이번 주/누적 사용량
- **자주 반복하는 질문 TOP 5** — "아 이건 외워야겠다" 스스로 깨닫게
- 기능별 호출 분포
- **"만약 이 모델로 썼다면?"** 비용 비교 (GPT-4o / Claude / Gemini)
- 최근 10건 호출 기록

치트시트·용어 사전·힌트 캐시는 `절약` 카운터에 기록 — 얼마나 아꼈는지 눈에 보인다.

### ⚡ 에디터 빠른 도구

무거운 스레드 없이, 선택 → 단축키 → 끝. 모두 토큰 리포트에 자동 집계됨.

| 기능 | 트리거 | 핵심 |
|---|---|---|
| **🧭 에러 힌트** | `Ctrl+Alt+E` / 에디터 우클릭 | 로컬 `errors.json`(흔한 패턴 29종) 먼저 매칭 → 없으면 AI fallback. 로컬 히트는 토큰 0원 |
| **💬 커밋 메시지 힌트** | `Ctrl+Alt+M` / SCM 패널 타이틀 버튼 | `git diff --staged` → AI가 Conventional Commits 후보 3개 → QuickPick → SCM input 자동 채움 |
| **🧐 커밋 전 셀프 리뷰** | `Ctrl+Alt+R` / SCM 패널 타이틀 버튼 | `git diff --staged`에서 `console.log`·`any`·TODO·시크릿·충돌 마커 등 로컬 점검 → AI가 변경 요약 + 셀프 체크 질문. PR 올리기 전에 부끄러움 방지 |
| **✏️ 이름 추천** | `Ctrl+Alt+N` / 선택 후 우클릭 | 선택 식별자 + 주변 컨텍스트 → 5개 후보 → 선택하면 선택 영역 치환 |
| **📦 이 패키지 뭐야?** | 팔레트 / `package.json`·`requirements.txt` 우클릭 | 워크스페이스 의존성 QuickPick or 직접 입력 → AI가 "뭐하는 거·언제 써·대안" 3~5줄 설명. **같은 패키지 두 번째부터 캐시 히트로 토큰 0원** |
| **📚 오늘의 학습 회고** | 팔레트 | tokenTracker 기록만 가공 — 오늘 반복 질문 TOP 3·많이 쓴 기능·인사이트 힌트. 토큰 0원 |

---

## 설치 & 시작

### 1. 설치

VSCode Marketplace에서 `DevNavi` 검색 (배포 후) 또는 `.vsix` 파일로 수동 설치.

### 2. API 키 설정 (선택)

AI 기능(코드 가이드·용어 사전 AI fallback·프로젝트 네비 로드맵)을 쓰려면 API 키가 필요하다.

`Ctrl+Shift+P` → **`DevNavi: API 키 설정`**

지원 프로바이더:
- **OpenAI** (GPT-4o / 4o-mini)
- **Anthropic** (Claude)
- **Google** (Gemini)

키는 VSCode 내장 `SecretStorage`에 안전하게 저장된다.

프로바이더 전환: `DevNavi: LLM 프로바이더 선택`

### 3. 사용

Activity Bar 왼쪽에서 **DevNavi 아이콘** 클릭 → 사이드바 열림.

주요 단축키:

| 키 | 기능 |
|---|---|
| `Ctrl+Alt+Q` | 선택한 코드 설명 |
| `Ctrl+Alt+H` | 힌트만 받기 |
| `Ctrl+Alt+W` | 이 단어 뭐야? |
| `Ctrl+Alt+E` | 이 에러 힌트 |
| `Ctrl+Alt+N` | 이름 추천 |
| `Ctrl+Alt+M` | 커밋 메시지 힌트 |
| `Ctrl+Alt+R` | 커밋 전 셀프 리뷰 |

---

## 기술 스택

- **VSCode Extension API** — TreeView / Comments API / CodeActionProvider / TextDocumentContentProvider / StatusBarItem / FileDecorationProvider
- **TypeScript** (strict mode)
- **Webpack** 번들링 (tree-shaking)
- **프로바이더 중립 LLM 어댑터** — OpenAI · Claude · Gemini를 하나의 `askLLM()` 인터페이스로 (SDK 없이 `fetch` 직접)
- **영속화** — 민감정보는 `SecretStorage`, 설정·기록은 `globalState`
- **UI** — TreeView + Markdown Preview 가상 문서 (Webview 최소화, 네이티브 느낌)

---

## 프로젝트 구조

```
apps/extension/src/
├── extension.ts              # 진입점 (lazy loading)
├── data/
│   ├── cheatsheet.json       # 기본 명령어
│   └── jargon.json           # 기본 용어
├── providers/                # TreeView / Comments / Decorations
├── commands/                 # 사용자 액션
├── storage/                  # globalState / SecretStorage 래퍼
└── utils/
    ├── llm.ts                # 프로바이더 어댑터 + trackedAskLLM
    └── prompts.ts            # 프롬프트 빌더
```

---

## 안 하는 것 (포지셔닝)

- ❌ 코드 자동완성 — Copilot 영역
- ❌ 완성 코드 제공 — 답 주면 의미 없음
- ❌ 화려한 토큰 대시보드 — 조용한 게 핵심

---

## 로드맵

- [x] 치트시트 (검색·복사·커스텀)
- [x] 개발자 용어 사전 (로컬 + AI fallback + 커스텀)
- [x] 코드 가이드 (Comments API 인라인)
- [x] 프로젝트 네비게이터 (AI 로드맵 + 체크리스트)
- [x] 토큰 절약 시스템 (상태바 + 반복 질문 추적)
- [x] 에디터 빠른 도구 (에러 힌트 · 커밋 메시지 · 이름 추천)
- [ ] Marketplace 배포
- [ ] 데모 영상 / GIF

---

## 라이선스

MIT
