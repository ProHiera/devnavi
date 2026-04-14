# DevNavi

> AI 시대 신입 개발자를 위한 조수석 네비게이터
> — Copilot이 짜주는 코드, 그게 뭔지는 알아야 하잖아.

VSCode Extension. Copilot/Cursor와 **공존**하며 AI가 짜준 코드를 **이해**할 수 있게 돕는다.

자세한 설명 · 설치 · 단축키는 **[apps/extension/README.md](./apps/extension/README.md)** 참고.

## 핵심 기능

- 🧭 **치트시트** — git/터미널/npm 명령어 + 커스텀, 로컬 JSON (토큰 0원)
- 📖 **개발자 용어 사전** — ❌/✅/💡 포맷, 로컬 우선 + AI fallback
- 🗺️ **프로젝트 네비게이터** — AI가 Phase별 체크리스트 생성, 힌트만 제공
- 💬 **코드 가이드** — Comments API 기반 인라인 스레드, 답 대신 방향 제시
- 🪙 **토큰 절약 시스템** — 조용한 상태바 + 반복 질문 추적 리포트
- ⚡ **에디터 빠른 도구** — 에러 힌트 (로컬 사전 + AI) · 커밋 메시지 힌트 · 이름 추천

## 모노레포 구조

```
devnavi/
├── apps/
│   └── extension/   # VSCode Extension (본체)
├── packages/        # 공유 코드
├── docs/            # 설계 문서
└── CLAUDE.md        # 프로젝트 컨텍스트
```

## 개발

```bash
cd apps/extension
npm install
npm run compile     # webpack 번들
# F5로 Extension Development Host 실행
```

## 라이선스

MIT
