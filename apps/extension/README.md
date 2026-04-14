# DevNavi

> **Copilot이 짜주는 코드, 그게 뭔지는 알아야 하잖아.**

AI가 대신 짜준 코드를 **이해**하고, 작은 건 **직접 고칠 수 있게** 돕는 VSCode 확장.
답을 주지 않고 힌트를 줍니다. 그리고 조용히 토큰을 아껴줍니다.

---

## 목차

1. [처음 5분 셋업](#처음-5분-셋업)
2. [API 키 발급 가이드 (프로바이더별)](#api-키-발급-가이드)
3. [기능 & 여는 법](#기능--여는-법)
4. [단축키 & 커스터마이징](#단축키--커스터마이징)
5. [토큰 절약 로직 (공개)](#토큰-절약-로직-공개)
6. [자주 묻는 것](#자주-묻는-것)
7. [포지셔닝](#포지셔닝)

---

## 처음 5분 셋업

### 1. 설치 & 사이드바 열기

VSCode Marketplace에서 **DevNavi** 검색 → 설치 → 좌측 Activity Bar의 **DevNavi 아이콘** 클릭.
치트시트 · 용어 사전 · 프로젝트 네비 세 개 뷰가 보이면 OK.

### 2. 프로바이더 고르기

- **GitHub Copilot 구독자** → 그대로 쓰세요. API 키 발급 불필요.
- **Copilot 없음** → Anthropic · OpenAI · Google 중 하나의 API 키를 받아오세요. (아래 [발급 가이드](#api-키-발급-가이드))
- **일단 로컬만 써볼래** → 아무 설정 없이 치트시트 · 용어 사전 · 에러 힌트 로컬 매칭 · 학습 회고는 전부 동작합니다.

### 3. 바로 해볼 3가지

| # | 해보기 | 기대 결과 |
|---|---|---|
| 1 | 사이드바 **치트시트** → `git commit` 노드 우클릭 → **"터미널에 보내기"** | 통합 터미널에 명령어 자동 삽입 |
| 2 | 에디터에서 코드 몇 줄 드래그 → **`Ctrl+Alt+Q`** | 선택 영역 바로 **아래에 인라인 스레드**로 설명 |
| 3 | 사이드바 **프로젝트 네비** → `+` → `"할일 앱 만들기"` 입력 | AI가 Phase별 체크리스트 자동 생성 |

---

## API 키 발급 가이드

> **결론부터**: Copilot 구독 있으면 그거 쓰세요. 없으면 **Gemini** 가 무료 tier 있어서 가장 진입장벽 낮음.

### 옵션 A — GitHub Copilot 구독 재활용 ⭐ 추천

**추가 과금 없음**. 이미 내고 있는 Copilot 쿼터에서 차감됩니다.

1. VSCode Marketplace에서 **GitHub Copilot Chat** 확장 설치
2. 우측 하단 상태바 또는 팔레트 `GitHub Copilot: Sign in`으로 GitHub 로그인
3. `Ctrl+Shift+P` → `DevNavi: LLM 프로바이더 선택` → **GitHub Copilot (구독 재활용)**
4. DevNavi AI 기능 첫 호출 시 "이 확장이 Language Model 써도 돼?" 모달 → **허용**
5. 끝. 키 저장 단계 없음.

> 내부적으로 VSCode **Language Model API** (`vscode.lm.selectChatModels`) 를 사용합니다.모델은 Copilot이 외부 확장에 열어준 family 중에서 자동 선택 (`gpt-4o` → `gpt-4` → `claude-3.5-sonnet` → `gpt-3.5-turbo` 순 fallback).

### 옵션 B — Anthropic (Claude)

1. [console.anthropic.com](https://console.anthropic.com) 접속 → 구글/이메일 로그인
2. 좌측 메뉴 **API Keys** → **Create Key**
3. 크레딧 충전 ([Plans & Billing](https://console.anthropic.com/settings/billing) → 신용카드 등록, 최소 $5)
4. ⚠️ **Claude Pro/Max 구독과는 별개 지갑** — 구독은 `claude.ai` 웹 전용이고 API는 따로 충전해야 합니다.
5. 키 복사 → VSCode에서 `Ctrl+Shift+P` → **`DevNavi: API 키 설정`** → Anthropic → 붙여넣기
6. `DevNavi: LLM 프로바이더 선택` → **Anthropic (Claude)**

기본 모델: `claude-haiku-4-5-20251001` (가장 싼 모델, 질문 1회당 보통 수십 원 수준)

### 옵션 C — OpenAI (GPT)

1. [platform.openai.com](https://platform.openai.com) → 로그인
2. 우상단 프로필 → **View API keys** → **+ Create new secret key**
3. 왼쪽 **Billing** → **Add payment method** + 크레딧 충전 (최소 $5)
4. 키 복사 → VSCode에서 `DevNavi: API 키 설정` → OpenAI → 붙여넣기
5. `DevNavi: LLM 프로바이더 선택` → **OpenAI (GPT)**

기본 모델: `gpt-4o-mini` (DevNavi API 직접 호출 경로에서는 4o-mini 접근 가능)

### 옵션 D — Google (Gemini) — **무료 tier 있음**

1. [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 접속 → 구글 로그인
2. **Create API key** → 프로젝트 선택 (또는 자동 생성)
3. 키 복사 → 신용카드 등록 **없이** 바로 사용 가능 (무료 tier는 분당/일일 제한 있음)
4. VSCode에서 `DevNavi: API 키 설정` → Google → 붙여넣기
5. `DevNavi: LLM 프로바이더 선택` → **Google (Gemini)**

기본 모델: `gemini-2.5-flash`

---

### 키 저장 위치

- VSCode 내장 **SecretStorage** (OS Keychain / Credential Manager에 암호화 저장)
- `settings.json` 평문 저장 ❌ · 파일 디스크에 남지 ❌
- 삭제: `Ctrl+Shift+P` → **`DevNavi: API 키 삭제`**

### 프로바이더 바꾸기

언제든지 `Ctrl+Shift+P` → **`DevNavi: LLM 프로바이더 선택`**.
키는 프로바이더별로 개별 저장되므로, 여러 개 등록해두고 스위칭하는 것도 가능합니다.

---

## 기능 & 여는 법

### 🟢 로컬 (API 호출 0회, 토큰 0원)

| | 기능 | 뭘 함 | 어떻게 열어? |
|---|---|---|---|
| 🧭 | **치트시트** | `git`·터미널·`npm`·`python`·`java` 명령어. 클릭 → 터미널 or 클립보드. 커스텀 추가/수정/삭제. | 사이드바 **치트시트** 뷰. 상단 🔍 검색, `+` 추가 |
| 📖 | **용어 사전** | `hoisting`·`dependency injection`·판교어 등 (`❌ 일반 방식 / ✅ 용어 / 💡 예시` 포맷). 로컬 히트 실패 시만 AI fallback. | 에디터에서 단어/구문 드래그 → **`Ctrl+Alt+W`** · 사이드바 **개발자 용어** 뷰에서 클릭 |
| 🧭 | **에러 힌트 (로컬)** | 흔한 에러 29종 (JS·Python·Java) 정규식 매칭 → 원인 + 확인할 것. 안 걸리면 AI fallback. | 에디터에서 에러 메시지 드래그 → **`Ctrl+Alt+E`** or 우클릭 |
| 📚 | **학습 회고** | 오늘 반복한 질문 TOP 3 + 많이 쓴 기능. 3번 이상 물은 건 "외울 타이밍"으로 찌름. | `Ctrl+Shift+P` → **`DevNavi: 오늘의 학습 회고`** |
| 🪙 | **토큰 상태바** | 하단 `🪙 절약 N회` — 클릭 시 건강검진 리포트 (모델별 추정 비용 포함). | VSCode **하단 상태바** 우측 🪙 아이콘 클릭 |

### 🔵 AI (본인 API 키 또는 Copilot 구독)

| | 기능 | 뭘 함 | 어떻게 열어? |
|---|---|---|---|
| 💬 | **코드 가이드** | 선택 영역 **바로 아래에 인라인 Comments 스레드**로 설명. 힌트 모드는 답 금지 · 방향만. | 코드 드래그 → **`Ctrl+Alt+Q`** (설명) · **`Ctrl+Alt+H`** (힌트) · `Ctrl+.` Code Action · 우클릭 |
| 🗺️ | **프로젝트 네비** | "뭐 만들 거야?" → Phase별 체크리스트 자동 생성. 태스크 클릭 → 힌트 (캐시됨). | 사이드바 **프로젝트 네비** → 상단 `+` · 태스크 우클릭 → **"힌트 받기"** |
| 🧐 | **커밋 전 셀프 리뷰** | `git diff --staged` 로컬 점검 (`console.log` · `any` · TODO · 시크릿 · 충돌 마커…) + AI 변경 요약. | SCM 툴바 버튼 · **`Ctrl+Alt+R`** |
| 💬 | **커밋 메시지 힌트** | Conventional Commits 후보 3개 → 고르면 SCM input 자동 채움. | SCM 툴바 버튼 · **`Ctrl+Alt+M`** |
| ✏️ | **이름 추천** | 선택 식별자 → 후보 5개 → 고르면 치환. | 식별자 드래그 → **`Ctrl+Alt+N`** · 우클릭 |
| 📦 | **패키지 설명** | 워크스페이스 의존성 QuickPick → "뭐하는 거 · 언제 써 · 대안". 선택 영역 **아래 인라인**으로 표시. **두 번째부턴 캐시 (토큰 0원)**. | `package.json` / `requirements.txt` / `pom.xml`에서 패키지명 드래그 → 우클릭 → **"DevNavi: 이 패키지 뭐야?"** |

> **UX 통일**: "이 XX 뭐야?" 계열(코드 / 용어 / 에러 / 패키지) 전부 **드래그 → 단축키 or 우클릭 → 선택 영역 바로 아래 인라인 스레드**로 통일했습니다. 페이지 전환 없음.

---

## 단축키 & 커스터마이징

### 기본 단축키

| 키 | 기능 |
|---|---|
| `Ctrl+Alt+Q` | 코드 설명 |
| `Ctrl+Alt+H` | 힌트만 받기 |
| `Ctrl+Alt+W` | 이 단어 뭐야? |
| `Ctrl+Alt+E` | 이 에러 힌트 |
| `Ctrl+Alt+N` | 이름 추천 |
| `Ctrl+Alt+M` | 커밋 메시지 힌트 |
| `Ctrl+Alt+R` | 커밋 전 셀프 리뷰 |

> Mac은 `Ctrl` → `Cmd`.

### 단축키 바꾸기

기본 단축키가 마음에 안 들거나 다른 확장과 충돌하면 원하는 키로 재지정할 수 있어요.

1. `Ctrl+Shift+P` → **`DevNavi: 단축키 설정`**
2. Keyboard Shortcuts UI가 **DevNavi 명령어만 필터된 채** 열립니다
3. 항목 우클릭 → **Change Keybinding** → 원하는 키 조합 입력 → Enter
4. VSCode가 `keybindings.json`에 자동 저장 · Settings Sync 로 기기 간 동기화도 됨

> 팔레트(`Ctrl+Shift+P` → `DevNavi:`)로는 **모든 기능**을 단축키 없이도 전부 호출할 수 있어요. 단축키를 기억할 필요 없음.

---

## 마우스로 하는 법

단축키 외워두지 않아도 **클릭 / 우클릭**만으로 전부 가능합니다.

### 사이드바 (Activity Bar 좌측 DevNavi 아이콘)

**치트시트 뷰**
- 카테고리 클릭 → 펼치기/접기
- 명령어 클릭 → **클립보드 복사** (기본 동작)
- 명령어 우측 🖥️ 인라인 버튼 → **터미널에 바로 보내기**
- 명령어 우클릭 → `터미널에 보내기` · `클립보드에 복사`
- **커스텀 명령어** 우클릭 → `수정` · `삭제`
- 뷰 상단 툴바 → 🔍 검색 · ➕ 커스텀 추가 · 🔄 새로고침

**개발자 용어 뷰**
- 카테고리 펼치기 → 용어 클릭 → **상세 패널** 열림
- 뷰 상단 툴바 → 📖 이 단어 뭐야? (선택 영역 lookup) · ➕ 커스텀 추가 · 🔄 새로고침
- **커스텀 용어** 우클릭 → `수정` · `삭제`

**프로젝트 네비 뷰**
- 태스크 좌측 체크박스 클릭 → **완료/미완료 토글**
- 태스크 우클릭 → `힌트 받기` · `완료/해제`
- 프로젝트 우클릭 → `프로젝트 삭제`
- 뷰 상단 툴바 → ➕ 프로젝트 시작 · 🔄 새로고침

### 에디터 (코드 창)

- 코드 드래그 선택 → **우클릭** → DevNavi 메뉴 그룹:
  - `이 코드 뭐야?` (AI 설명)
  - `힌트만 줘` (방향만)
  - `이 단어 뭐야?` (용어 사전)
  - `이 에러 힌트` (에러 분석)
  - `이름 추천` (식별자 리팩토링)
- 선택 후 **전구 💡 아이콘** (Code Action) → 같은 메뉴 노출

### 특수 파일 우클릭

- `package.json` · `requirements.txt` · `pom.xml` · `*.gradle` 내에서 패키지명 드래그 → 우클릭 → **`이 패키지 뭐야?`**

### SCM 패널 (좌측 Source Control 🔀)

- 패널 **상단 툴바** 버튼:
  - 📋 **커밋 전 셀프 리뷰**
  - 💬 **커밋 메시지 힌트** (고르면 input에 자동 삽입)

### 상태바 (VSCode 하단 우측)

- 🪙 **절약 N회** 클릭 → **토큰 사용 리포트 패널** (건강검진 리포트)

### 인라인 스레드 (코드 설명 결과)

- 스레드 우측 상단 **`↩️ 답글`** 버튼 → AI에게 follow-up 질문
- 스레드 왼쪽 `▼` → 접기 / 펼치기
- 스레드 우측 `✕` → 닫기

### 명령 팔레트 (마우스 안 쓸 때)

`Ctrl+Shift+P` → `DevNavi` 입력 → 전체 명령 목록. 단축키/사이드바/우클릭 어느 경로든 사용 가능한 기능 전부 여기에 있습니다.

---

## 토큰 절약 로직 (공개)

DevNavi의 핵심 가치는 **"AI를 만드는 게 아니라, AI를 더 잘 쓰게 해주는 것"**.
아래는 실제로 어떻게 토큰을 아끼는지 — 코드와 함께 숨김 없이 공개합니다.

### 1. 로컬 우선 (Local-First)

API 호출하기 **전에** 로컬 데이터에서 먼저 찾습니다.

| 기능 | 로컬 소스 | 저장 위치 |
|---|---|---|
| 치트시트 기본 명령어 | `src/data/cheatsheet.json` | 번들 (디스크 X) |
| 치트시트 커스텀 | `context.globalState` | VSCode 로컬 |
| 용어 사전 기본 | `src/data/jargon.json` | 번들 |
| 용어 사전 커스텀 | `context.globalState` | VSCode 로컬 |
| 에러 패턴 | `src/data/errors.json` (정규식 29종) | 번들 |

**로컬 히트 시**: `tokenTracker.record({cached: true, model: 'local'})` — API 호출 **없이** "절약 1회"로 기록만 남김. 상태바 `🪙` 카운터에 반영.

### 2. 결과 캐싱 (Cache Hit)

같은 질문은 두 번째부터 API를 호출하지 않습니다.

- **패키지 설명**: `ecosystem:package` 키로 `globalState`에 최대 200개 LRU 캐시. 같은 `axios` 두 번째 클릭 → 0원.
- **프로젝트 네비 힌트**: 태스크별 힌트를 메모리 캐시. 같은 태스크 재클릭 → 0원.
- **질문 정규화**: `normalizeQuestion()` 으로 공백/대소문자 통일 → "git stash?" 와 "Git Stash" 는 같은 질문으로 인식.

### 3. AI Fallback (로컬 miss 시에만)

로컬에서 못 찾았을 때**만** 본인 키로 API 호출. 호출 후 응답은 로컬 캐시에 저장돼서 다음번엔 다시 0원.

```
용어 lookup 플로우:
  드래그 → jargon.lookup(query)
    ├─ 히트 → ❌/✅/💡 렌더링 (0원, record cached:true)
    └─ miss → 유사 용어 3개 제안 + "AI에게 물어보기"
              └─ AI 선택 시만 → 본인 키로 호출
```

### 4. 프로바이더 비용 투명화

상태바 `🪙` 클릭 → **"만약 이 모델로 썼다면?"** 표:
- 현재 세션 · 오늘 · 이번 주 누적
- 모델별 (`gpt-4o-mini` / `claude-haiku` / `gemini-2.5-flash` 등) 추정 비용 나란히 비교
- "지금 `Haiku` 쓰는데 `Flash` 로 바꾸면 1/10" 같은 의사결정을 눈으로 확인

### 5. 반복 질문 감지

**학습 회고** (`DevNavi: 오늘의 학습 회고`) 는 질문 로그를 읽어서 **같은 질문을 3번 이상 한 항목**을 띄웁니다.
"아 이건 외워야겠다 / 커스텀 치트시트에 넣어야겠다" 를 **유저 스스로** 깨닫게 하는 게 목적 — 답을 대신 주지 않습니다.

### 6. 프롬프트 최소화

- `max_tokens: 1024` 고정 — 장황한 답변 방지
- 코드 가이드는 선택 영역만 보냄 — 파일 전체 X
- 패키지 설명은 패키지 이름 + 생태계만 — 의존성 트리 X
- 시스템 프롬프트에 **"서론/사족/사과 금지"** 명시

### 7. 네트워크 복원력

429 · 502/503/504 · 네트워크 끊김 → 지수 백오프 (`1s → 3s → 실패`) 로 3회 재시도.
Copilot은 모델 거부 시 다음 family 후보로 자동 fallback — 첫 모델 실패로 토큰이 "버려지는" 상황 방지.

> 📄 **전체 구현**: [`src/utils/llm.ts`](src/utils/llm.ts) · [`src/storage/tokenTracker.ts`](src/storage/tokenTracker.ts) · [`src/commands/packageExplain.ts`](src/commands/packageExplain.ts)

---

## 자주 묻는 것

**Q. API 키 없이 쓸 수 있는 기능은?**
치트시트 · 용어 사전 로컬 매칭 · 에러 힌트 로컬 매칭(29종) · 학습 회고 · 토큰 상태바 · 프로젝트 네비 수동 체크리스트.
**추가로 Copilot 구독만 있으면** AI 기능도 전부 키 없이 사용 가능.

**Q. Claude Pro/Max 구독으로 DevNavi 쓸 수 있나요?**
❌ Claude Pro/Max는 `claude.ai` 웹/앱 + Claude Code CLI 전용 지갑, Anthropic API는 별도 크레딧.
**우회 팁**: GitHub Copilot Chat에서 Claude 3.5 Sonnet이 제공되므로, Copilot 구독 있으면 `copilot` 프로바이더로 Claude 호출 가능.

**Q. 과금이 걱정돼요.**
상태바 🪙 → "만약 이 모델로 썼다면?" 표로 누적 추정. `Haiku` · `Gemini Flash` · `gpt-4o-mini` 는 질문 1회당 **수 원 ~ 수십 원** 수준.
그리고 같은 질문은 캐시에서 꺼내니 반복 비용 0.

**Q. 내 코드가 어디로 가나요?**
선택한 코드/텍스트가 본인이 설정한 프로바이더 API로만 전송됩니다. DevNavi 서버 없음. 로컬에서 익스텐션이 직접 호출 → 응답받아 인라인 표시.

**Q. 프로젝트 네비 힌트가 답을 통째로 주면 어떡해요?**
프롬프트 자체가 "답 금지, 방향만" 규칙. 그래도 답이 나오면 이슈로 알려주세요.

**Q. 한국어로만 동작하나요?**
UI · 응답 모두 한국어. 영어 코드/에러는 그대로 입력으로 처리합니다.

**Q. 커스텀 명령어/용어는 어디 저장돼요?**
VSCode `globalState` — 기기별 로컬. Settings Sync 켜져 있으면 자동 동기화됩니다.

---

## 포지셔닝

- ❌ 자동완성 — Copilot 영역
- ❌ 완성 코드 제공 — 답 주면 의미 없음
- ✅ "대신 해주는 게 아니라, 할 수 있게 해주는 것"

## 라이선스

MIT · © 2026 hiera
