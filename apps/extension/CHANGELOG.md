# Changelog

DevNavi의 주요 변경사항을 기록. [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/) 형식 · [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-04-14

첫 공개 릴리즈. AI 시대 신입 개발자의 조수석 네비게이터.

### Added

**로컬 기능 (토큰 0원)**
- 🧭 치트시트 — `git`/터미널/`npm`/`python`/`java` 명령어 TreeView, 터미널 전송·클립보드·검색·커스텀 추가
- 📖 개발자 용어 사전 — 로컬 사전 (`❌/✅/💡` 포맷) + 에디터 인라인 스레드 표시 (`Ctrl+Alt+W`)
- 🧭 에러 힌트 — JS/Python/Java 29종 로컬 매칭 (`Ctrl+Alt+E`)
- 📚 학습 회고 — 오늘 반복 질문 TOP 3 + 많이 쓴 기능 리포트
- 🪙 토큰 상태바 — 절약 횟수 · "만약 이 모델로 썼다면?" 비용 비교

**AI 기능 (본인 API 키)**
- 💬 코드 가이드 — 선택 영역에 인라인 Comments 스레드로 설명·힌트 (`Ctrl+Alt+Q`, `Ctrl+Alt+H`)
- 🗺️ 프로젝트 네비 — 목표 → Phase별 체크리스트 자동 생성 + 태스크별 힌트 (캐시)
- 🧐 커밋 전 셀프 리뷰 — 로컬 점검(`console.log`·`any`·TODO·시크릿·충돌 마커) + AI 요약 (`Ctrl+Alt+R`)
- 💬 커밋 메시지 힌트 — Conventional Commits 후보 3개 → SCM input 자동 채움 (`Ctrl+Alt+M`)
- ✏️ 이름 추천 — 식별자 후보 5개 → 치환 (`Ctrl+Alt+N`)
- 📦 패키지 설명 — `package.json`/`requirements.txt`/`pom.xml`/`.gradle` 의존성 설명 + 캐시

**프로바이더**
- GitHub Copilot (VSCode Language Model API · 구독 재활용, 추천)
- Anthropic Claude · OpenAI GPT · Google Gemini (본인 API 키)
- 429/5xx 응답 시 자동 재시도 (최대 3회, 지수 백오프)
