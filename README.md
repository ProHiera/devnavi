# DevNavi

> Copilot이 짜주는 코드, 그게 뭔지는 알아야 하잖아.

AI가 짜준 코드를 **이해**하고 직접 고칠 수 있게 돕는 VSCode 확장.
Copilot·Cursor와 공존한다. 답 대신 힌트를 준다.

설치·기능·단축키는 **[apps/extension/README.md](./apps/extension/README.md)** 참고.

## 한눈에

- 🧭 치트시트 · 📖 용어 사전 · 🧭 에러 힌트 — **로컬, 토큰 0원**
- 💬 코드 가이드 · 🗺️ 프로젝트 네비 — **AI가 힌트만** (답 금지)
- 🧐 커밋 전 셀프 리뷰 · 💬 커밋 메시지 · ✏️ 이름 추천 · 📦 패키지 설명
- 📚 학습 회고 · 🪙 토큰 상태바 — **반복 질문 추적**해 "외울 타이밍" 알려줌

## 모노레포

```
devnavi/
├── apps/extension/   # VSCode Extension (본체)
├── packages/         # 공유 코드
└── docs/             # 설계 문서
```

## 개발

```bash
cd apps/extension
npm install
npm run compile    # F5로 Extension Development Host
```

## 라이선스

MIT
