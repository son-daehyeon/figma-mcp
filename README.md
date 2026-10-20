# figma-mcp

> Figma 데스크톱을 플러그인 API로 조작하는 로컬 브리지 (relay · CLI · 개발 플러그인)

Figma 데스크톱에서 실행하는 개발 플러그인, 로컬 relay 서버, CLI로 구성된 브리지다. 에이전트나 스크립트가 플러그인 API 코드를 실행해 디자인 파일을 읽고 고치고, 노드를 PNG로 내보내 결과를 눈으로 확인할 수 있게 한다. 공식 Figma MCP의 호출 한도를 거치지 않고 로컬에서 쓰려고 만들었다.

## 주요 기능
- `exec`: 플러그인 API 코드를 async 함수 본문으로 실행하고 JSON 결과를 돌려준다. `--args`로 스크립트에 인자를 넘긴다
- `ops`: 동적 코드 실행이 막힌 환경을 위한 JSON 연산 목록(`tree`, `find`, `get`, `set`, `create`, `instance`, `clone`, `move`, `resize`, `delete`, `setText`, `bindVariable`, `setMode`)
- `export`: 노드를 PNG·JPG·SVG로 내보내 `.out/`에 저장한다
- `vars`: 로컬 변수를 모든 모드 값과 함께 JSON으로 내보낸다
- `ping`, `info`: relay·플러그인 연결 상태, 파일·페이지·선택 정보 확인
- relay는 명령을 순서대로 하나씩 처리하고, 127.0.0.1에만 바인딩하며 `.token` 파일의 토큰이 있는 요청만 받는다
- `scripts/`: 노드에 저장한 흐름 데이터로 페이지를 다시 배치하는 `layout-flow.js`, 레이어 정리 `clean-layers.js`, 전체 페이지 내보내기용 슬라이스 `page-slice.js`, PNG 픽셀 비교 `pixdiff.mjs`

## 기술 스택
| 영역 | 기술 |
|---|---|
| 언어 | TypeScript 7 (Node.js에서 `.ts`를 직접 실행) |
| 프레임워크 | Figma Plugin API, ws 8 (WebSocket) |
| 인프라 | esbuild (플러그인 번들), node:test |

## 구조
```
cli.ts          CLI (ping, info, exec, ops, export, vars)
protocol.ts     relay·플러그인·CLI가 공유하는 명령 타입
relay/          HTTP + WebSocket relay 서버와 테스트
plugin/         Figma 개발 플러그인 (code.ts, ops.ts, variables.ts, ui)
scripts/        레이아웃·레이어 정리·내보내기·픽셀 비교 스크립트
relaunch.applescript  macOS에서 플러그인 재실행
```

## 실행
```bash
pnpm install
pnpm build
# Figma 데스크톱 → Plugins → Development → Import plugin from manifest… → plugin/manifest.json
# Plugins → Development → Figma Bridge 실행 후 창을 열어 둔다
pnpm relay
node cli.ts ping
node cli.ts exec -e "return figma.root.name"
node cli.ts export 1:23 --scale 2
```
환경 변수: `FIGMA_BRIDGE_PORT` (플러그인 manifest가 3056만 허용하므로 바꿀 때는 함께 바꾼다)

---
2026 · 개인 프로젝트 · 사용 중
