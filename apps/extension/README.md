# DevNavi

> **Copilot이 짜주는 코드, 그게 뭔지는 알아야 하잖아.**

AI가 대신 짜준 코드를 **이해**하고, 작은 건 **직접 고칠 수 있게** 돕는 VSCode 확장.
답을 주지 않고 힌트를 줍니다.

---

## 처음 5분 셋업

### 1. 사이드바 열기

왼쪽 Activity Bar에서 **DevNavi 아이콘** 클릭 → 치트시트 · 용어 사전 · 프로젝트 네비 세 개 뷰가 보입니다.

### 2. API 키 등록 (AI 기능을 쓰려면)

AI 기능(코드 가이드·프로젝트 네비 로드맵·에러 힌트 AI fallback·패키지 설명 등)은 본인 API 키가 필요해요.
**치트시트·용어 사전·에러 힌트 로컬 매칭·학습 회고는 키 없이도 전부 동작합니다.**

**키 받는 법** — 아래 중 하나만 있으면 됩니다:

| 프로바이더 | 가입 · 키 발급 | 기본 모델 | 참고 |
|---|---|---|---|
| **GitHub Copilot (구독 재활용)** | 키 불필요 — Copilot Chat 확장 설치 + GitHub 로그인만 | Copilot이 제공하는 family (`gpt-4o`, `claude-3.5-sonnet` 등) | **추천** — 이미 Copilot 구독 있으면 추가 과금 없음. VSCode LM API가 쿼터 차감 |
| **Anthropic (Claude)** | [console.anthropic.com](https://console.anthropic.com) → API Keys | `claude-haiku-4-5` | ⚠️ Claude Max/Pro 구독이랑 **별개 지갑** — API 크레딧 따로 충전 필요 |
| **OpenAI** | [platform.openai.com](https://platform.openai.com) → API keys | `gpt-4o-mini` | 가장 싸고 무난 |
| **Google (Gemini)** | [aistudio.google.com](https://aistudio.google.com/apikey) | `gemini-1.5-flash` | 무료 tier 있음 — 카드 없이 바로 사용 |

> 💡 사용량은 상태바 `🪙` 아이콘 클릭 → **"만약 이 모델로 썼다면?"** 표에서 모델별 추정 비용을 볼 수 있습니다.

**VSCode에 등록**:

- **Copilot 구독자** — 키 설정 단계 자체가 없음. `Ctrl+Shift+P` → `DevNavi: LLM 프로바이더 선택` → **GitHub Copilot** 고르면 끝. 첫 호출 시 VSCode가 "이 확장이 LM 써도 돼?" 모달을 한 번 띄움 — 허용하면 이후 자동.
- **API 키 프로바이더 (Anthropic / OpenAI / Google)**:
  1. `Ctrl+Shift+P` → `DevNavi: API 키 설정` → Enter
  2. 프로바이더 선택
  3. 키 붙여넣기 → Enter
  4. `DevNavi: LLM 프로바이더 선택`에서 해당 프로바이더로 전환

키는 VSCode 내장 `SecretStorage`에 암호화 저장됩니다. (settings.json에 평문 저장 X)

**프로바이더 전환**: `Ctrl+Shift+P` → `DevNavi: LLM 프로바이더 선택`
**키 삭제**: `Ctrl+Shift+P` → `DevNavi: API 키 삭제`

### 3. 바로 해볼 3가지

- 사이드바 **치트시트**에서 `git commit` 우클릭 → "터미널에 보내기"
- 코드 몇 줄 선택 → **`Ctrl+Alt+Q`** → 인라인 스레드에 설명
- 사이드바 **프로젝트 네비**의 `+` → "할일 앱 만들기" 입력 → Phase 체크리스트 자동 생성

---

## 기능 & 여는 법

### 로컬 (토큰 0원)

| | 기능 | 뭘 함 | 어떻게 열어? |
|---|---|---|---|
| 🧭 | **치트시트** | `git`·터미널·`npm`·`python`·`java` 명령어. 클릭 → 터미널 or 클립보드. 커스텀 추가. | 사이드바 **치트시트** 뷰. 상단 🔍 버튼으로 검색, `+` 버튼으로 커스텀 추가 |
| 📖 | **용어 사전** | `hoisting`·판교어 등 로컬 사전 우선 (`❌/✅/💡`). 없으면 AI fallback. | 에디터에서 단어 선택 → **`Ctrl+Alt+W`** · 사이드바 **개발자 용어** 뷰 |
| 🧭 | **에러 힌트** | 흔한 에러 29종 (JS·Python·Java) 로컬 매칭. 안 걸리면 AI. | 에디터에서 에러 메시지 선택 → 우클릭 **"DevNavi: 이 에러 힌트"** or **`Ctrl+Alt+E`** |
| 📚 | **학습 회고** | 오늘 반복한 질문 TOP 3 + 많이 쓴 기능. 3번 이상 물은 건 "외울 타이밍"으로 찌름. | `Ctrl+Shift+P` → **`DevNavi: 오늘의 학습 회고`** |
| 🪙 | **토큰 상태바** | 하단 `🪙 절약 N회` — 클릭 시 건강검진 리포트. | VSCode **하단 상태바** 우측 🪙 아이콘 클릭 |

### AI (본인 API 키)

| | 기능 | 뭘 함 | 어떻게 열어? |
|---|---|---|---|
| 💬 | **코드 가이드** | 선택 → 인라인 Comments 스레드로 설명. 힌트 모드는 답 금지 방향만. | 코드 선택 → 우클릭 **"DevNavi: 이 코드 뭐야?"** · **`Ctrl+Alt+Q`** (설명) / **`Ctrl+Alt+H`** (힌트만) · `Ctrl+.` Code Action |
| 🗺️ | **프로젝트 네비** | "뭐 만들 거야?" → Phase별 체크리스트. 태스크 클릭 → 힌트 (캐시됨). | 사이드바 **프로젝트 네비** 뷰 → 상단 `+` 버튼 · 태스크 우클릭 → **"힌트 받기"** |
| 🧐 | **커밋 전 셀프 리뷰** | `git diff --staged` 로컬 점검 (`console.log`·`any`·TODO·시크릿·충돌 마커…) + AI 변경 요약. | SCM 패널 **상단 툴바** 버튼 · **`Ctrl+Alt+R`** · `Ctrl+Shift+P` → `DevNavi: 커밋 전 셀프 리뷰` |
| 💬 | **커밋 메시지 힌트** | Conventional Commits 후보 3개 → 고르면 SCM input 자동 채움. | SCM 패널 **상단 툴바** 버튼 · **`Ctrl+Alt+M`** |
| ✏️ | **이름 추천** | 선택 식별자 → 후보 5개 → 고르면 치환. | 식별자 선택 → 우클릭 **"DevNavi: 이름 추천"** · **`Ctrl+Alt+N`** |
| 📦 | **패키지 설명** | 워크스페이스 의존성 QuickPick → "뭐하는 거·언제 써·대안". **두 번째부턴 캐시 (토큰 0원)**. | `package.json`·`requirements.txt`·`pom.xml`에서 **우클릭** → "DevNavi: 이 패키지 뭐야?" · `Ctrl+Shift+P` → 같은 명령 (워크스페이스 의존성 목록) |

---

## 단축키 요약

| 키 | 기능 |
|---|---|
| `Ctrl+Alt+Q` | 코드 설명 |
| `Ctrl+Alt+H` | 힌트만 받기 |
| `Ctrl+Alt+W` | 이 단어 뭐야? |
| `Ctrl+Alt+E` | 이 에러 힌트 |
| `Ctrl+Alt+N` | 이름 추천 |
| `Ctrl+Alt+M` | 커밋 메시지 힌트 |
| `Ctrl+Alt+R` | 커밋 전 셀프 리뷰 |
| `Ctrl+Shift+P` → `DevNavi: …` | **전체 명령** (단축키 모를 때 이것만 기억) |

> Mac은 `Ctrl` → `Cmd`.

---

## 자주 묻는 것

**Q. API 키 없으면 뭐가 돼요?**
치트시트 · 용어 사전 로컬 매칭 · 에러 힌트 로컬 매칭(29종) · 학습 회고 · 토큰 상태바 · 프로젝트 네비 수동 체크리스트 — 전부 동작.
**추가로 Copilot 구독만 있으면** AI 기능 전부도 API 키 없이 사용 가능 (프로바이더 = `copilot`).

**Q. Claude Pro/Max 구독으로 DevNavi 쓸 수 있나요?**
아니요 — Claude Pro/Max는 `claude.ai` 웹/앱 + Claude Code CLI 전용 지갑이고, Anthropic API는 별도 크레딧입니다.
**우회**: GitHub Copilot 구독이 있다면 Copilot Chat에서 Claude 3.5 Sonnet이 제공되니, DevNavi의 `copilot` 프로바이더를 쓰면 Copilot 쿼터로 Claude 호출이 됩니다.

**Q. 과금이 걱정돼요.**
상태바 🪙 클릭 → "만약 이 모델로 썼다면?" 표로 누적 비용 추정 가능. Anthropic Haiku · Gemini Flash · OpenAI 4o-mini는 질문 1회당 수십 원 단위.

**Q. 프로젝트 네비 힌트가 답을 통째로 주면 어떡해요?**
프롬프트 자체가 "답 금지, 방향만" 규칙. 만약 답이 나오면 이슈로 알려주세요.

**Q. 한국어로만 동작하나요?**
UI·응답 모두 한국어. 영어 코드/에러는 그대로 처리합니다.

---

## 포지셔닝

- ❌ 자동완성 — Copilot 영역
- ❌ 완성 코드 제공 — 답 주면 의미 없음
- ❌ 화려한 UI — 조용히 녹아드는 게 핵심

## 라이선스

MIT
