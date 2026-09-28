/*
 * 화면 제목·버튼·안내 등 진행 UI 문구의 단일 원본.
 * 시나리오와 피드백의 내용 문장은 각각 scenarios.js, feedback.js에서 관리한다.
 */
(function () {
  "use strict";

  window.TKI.copy = {
    brand: "갈등 대응 코치",
    steps: ["백분위 입력", "프로파일", "진단 브리핑", "선택지 실습", "피드백", "종합"],
    onboarding: {
      title: "TKI 진단 결과 기반<br>갈등 대응 연습",
      submit: "진단 브리핑 보기 →",
    },
    profile: {
      tag: "프로파일 설정",
      title: "업무 맥락을 알려주세요",
      confirm: "프로파일 확정 후 진단 브리핑 보기 →",
    },
    brief: {
      tag: "STEP 3 · 진단 브리핑",
      title: "TKI 심화 분석",
    },
    practice: {
      tag: "STEP 4 · 선택지 실습",
      prompt: "이 상황에서 어떻게 대응하시겠어요?",
      waiting: "대화가 이어지고 있습니다…",
      skip: "대화 즉시 보기",
    },
    feedback: {
      tag: "STEP 5 · 미니 피드백",
      title: "이번 실습 리포트",
    },
    summary: {
      tag: "STEP 6 · 종합 피드백",
      title: "종합 피드백 리포트",
      restart: "백분위부터 다시 시작하기 · 프로파일 유지",
    },
  };
})();
