# DevNavi

> **Copilot이 짜주는 코드, 그게 뭔지는 알아야 하잖아.**

AI가 대신 짜준 코드를 **이해**하고, 작은 건 **직접 고칠 수 있게** 돕는 VSCode 확장.
답을 주지 않고 힌트를 준다. Copilot·Cursor와 공존한다.

---

## 기능

### 로컬 (토큰 0원)

| | 기능 | 뭘 함 |
|---|---|---|
| 🧭 | **치트시트** | `git`·터미널·`npm`·`python`·`java` 명령어 TreeView. 클릭 → 터미널 or 클립보드. 커스텀 추가 가능. |
| 📖 | **용어 사전** | `hoisting`·판교어 등 로컬 사전 우선 (`❌/✅/💡` 포맷). 없으면 AI fallback. |
| 🧭 | **에러 힌트** | 흔한 에러 29종 (JS·Python·Java) 로컬 매칭. 안 걸리면 AI. |
| 📚 | **학습 회고** | 오늘 반복한 질문 TOP 3 + 많이 쓴 기능. 3번 이상 물은 건 "외울 타이밍"으로 찌름. |
| 🪙 | **토큰 상태바** | 하단 `🪙 절약 N회` · 클릭 시 건강검진 리포트 (반복 질문 · 모델별 비용 비교). |

### AI (본인 API 키)

| | 기능 | 뭘 함 |
|---|---|---|
| 💬 | **코드 가이드** | 선택 → 인라인 Comments 스레드로 설명. 힌트 모드는 답 금지 방향만. |
| 🗺️ | **프로젝트 네비** | "뭐 만들 거야?" → Phase별 체크리스트. 태스크 클릭 → 힌트 (캐시됨). |
| 🧐 | **커밋 전 셀프 리뷰** | `git diff --staged` 로컬 점검 (`console.log`·`any`·TODO·시크릿·충돌 마커…) + AI 변경 요약. |
| 💬 | **커밋 메시지 힌트** | Conventional Commits 후보 3개 → 고르면 SCM input 자동 채움. |
| ✏️ | **이름 추천** | 선택 식별자 → 후보 5개 → 고르면 치환. |
| 📦 | **패키지 설명** | `package.json`·`requirements.txt` 의존성 QuickPick → "뭐하는 거·언제 써·대안". **두 번째부턴 캐시 (토큰 0원)**. |

---

## 단축키

| 키 | 기능 |
|---|---|
| `Ctrl+Alt+Q` | 코드 설명 |
| `Ctrl+Alt+H` | 힌트만 받기 |
| `Ctrl+Alt+W` | 이 단어 뭐야? |
| `Ctrl+Alt+E` | 이 에러 힌트 |
| `Ctrl+Alt+N` | 이름 추천 |
| `Ctrl+Alt+M` | 커밋 메시지 힌트 |
| `Ctrl+Alt+R` | 커밋 전 셀프 리뷰 |

우클릭 · 팔레트 (`Ctrl+Shift+P` → `DevNavi: …`) · SCM 패널 타이틀에서도 접근 가능.

---

## 시작하기

1. **사이드바** — Activity Bar의 DevNavi 아이콘 클릭.
2. **API 키 (AI 기능용, 선택)** — `Ctrl+Shift+P` → `DevNavi: API 키 설정`.
   - OpenAI · Anthropic · Google 중 선택. `SecretStorage`에 저장됨.
   - 프로바이더 전환: `DevNavi: LLM 프로바이더 선택`.

API 키 없어도 로컬 기능 전부 동작.

---

## 개발

```bash
npm install
npm run compile   # webpack 번들 → dist/
# F5 → Extension Development Host
```

---

## 포지셔닝

- ❌ 자동완성 — Copilot 영역
- ❌ 완성 코드 제공 — 답 주면 의미 없음
- ❌ 화려한 UI — 조용히 녹아드는 게 핵심

## 라이선스

MIT
