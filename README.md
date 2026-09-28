# TKI 갈등 대응 AI 튜터 — 교수자 대시보드

학습자 튜터가 보낸 익명 결과를 코호트 단위로 집계해 보여줍니다.

> **이 저장소는 직접 고치지 마세요.**
> 튜터 저장소 [`tki_ai-tutor`](https://github.com/kirdedu26/tki_ai-tutor)가 단일 원본이고,
> 이곳은 그쪽 작업 폴더의 `publish_dashboard.py`가 생성합니다. 여기서 고치면 다음 배포 때
> 덮어써집니다.

## 여는 법

```
https://kirdedu26.github.io/tki_ai-tutor_dashboard/dashboard.html#token=<READ_TOKEN>
```

주소 끝의 `#token=` 이 없으면 "열람 권한이 없습니다"만 표시됩니다. 토큰은 Apps Script의
스크립트 속성 `READ_TOKEN` 값이며 코드에는 들어 있지 않습니다.

**이 주소를 공유하면 열람 권한을 준 것과 같습니다.** 전달하실 때 유의해 주세요.

## 튜터와 공유하는 파일

`src/scenarios.js` `src/profiles.js` `src/ui-copy.js` `src/styles.css`와 `fonts/`는 튜터
저장소와 같은 내용이어야 합니다. 유형 라벨이나 문구를 고쳤는데 이곳에 반영되지 않으면
교수자 화면에만 옛 라벨이 남습니다. 실제로 겪었던 문제라 생성 방식으로 바꿨습니다.

## 수집 항목

이름·학번은 수집하지 않습니다. 진단 백분위 5개, 프로파일(직군·역할·상대 유형), 실습별
타깃·상대·결말, 결정별 (단계·대응유형·상황 적합 경향)입니다.
