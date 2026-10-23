# 🍺 Perfect Pour — 맥주따르기게임

3D 생맥주 디스펜서의 레버와 맥주잔의 기울기·높이를 단계적으로 조작해 가장 완벽한 생맥주 한 잔을 만드는 웹 물리 시뮬레이션 게임이다.
설계 문서는 BD-0006, 요구사항은 REQ-0006이며, 미결정 사항을 어떻게 정했는지는 [docs/DECISIONS.md](docs/DECISIONS.md)에 있다.

## 실행

```bash
npm install
npm run dev        # 개발 서버
npm test           # 시뮬레이션 코어·공유 URL 단위 테스트
npm run build      # 타입 검사 + 정적 빌드 (dist/)
```

`?fps`를 붙여 접속하면 FPS가 표시된다.

## 조작

| 조작 | PC | 모바일 |
|---|---|---|
| 레버 아래 (맥주) | J | 레버 ▼ 맥주 |
| 레버 위 (거품) | K | 레버 ▲ 거품 |
| 잔 기울이기 / 세우기 | A / D | 기울이기 / 세우기 |
| 잔 올리기 / 내리기 | W / S | ▲ 올리기 / ▼ 내리기 |
| 다시 따르기 | R / Enter / Space | 버튼 |

키나 버튼을 한 번 누를 때마다 한 단계씩 움직이며, 누르고 있어도 반복되지 않는다.

## 구조

```text
src/
├─ config/balance.json      밸런스 설정값 (코드 수정 없이 조정)
├─ core/                    시뮬레이션 코어 — Three.js·DOM 비의존, 고정 시간 간격, 결정적
│  ├─ game.ts               GameController: 상태 전이(ready→pouring→ended→result), 스텝 순서
│  ├─ lever.ts              LeverController
│  ├─ glassController.ts    GlassController (기울기·높이, 노즐 충돌 방지, 보간)
│  ├─ flow.ts               FlowSimulator (목표/실제 유량, 지연, 끊김, Stream)
│  ├─ collision.ts          CollisionDetector (첫 충돌 표면, 6종 유형, 강도)
│  ├─ reaction.ts           ReactionResolver (거품 생성·파괴, 탄산 손실, 출렁임, 튀김)
│  ├─ beerState.ts          BeerState (층 모델, 거품 액체/기체 분리, 소멸)
│  ├─ overflow.ts           OverflowDetector (기울기 반영 수용 부피, 넘침)
│  ├─ geometry.ts           원뿔대 잔 형상, 기울어진 잔의 부피↔액면 높이
│  └─ score.ts              ScoreCalculator (5개 항목, 1000점, 칭호)
├─ record/                  ResultShare: LocalStorage 최고 기록, URL 공유·검증
├─ input/inputAdapter.ts    키보드·버튼 → Command
└─ view/                    표현 계층 — 코어 상태를 읽기만 한다
   ├─ scene.ts              Three.js 장면 (클리핑 평면으로 수평 액면 표현)
   ├─ effects.ts            장식 입자 (판정과 무관)
   ├─ audio.ts              Web Audio 합성 효과음
   └─ ui.ts                 HUD, 결과·비교 화면
```

## 배포

`main` 브랜치에 push하면 `.github/workflows/deploy.yml`이 테스트 → 빌드 → GitHub Pages 배포를 수행한다.
저장소 Settings → Pages → Source를 **GitHub Actions**로 설정해야 한다. 빌드는 상대 경로(`base: './'`)라 저장소 하위 경로에서도 그대로 동작한다.
