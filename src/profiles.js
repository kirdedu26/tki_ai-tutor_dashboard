/*
 * 학습자 프로파일과 역할별 시나리오 조정 규칙.
 * 직군·과제 역할·갈등 상대와 관련된 문구는 이 파일에서 관리한다.
 */
(function () {
  "use strict";

  var D = window.TKI;

  D.profiles = {
    options: {
      job: [
        { key: "research", label: "연구직" },
        { key: "administration", label: "행정직" },
      ],
      projectRole: [
        { key: "lead", label: "과제책임자" },
        { key: "member", label: "과제참여자" },
      ],
      opponent: [
        { key: "junior", label: "후배" },
        { key: "colleague", label: "동료" },
        { key: "otherDept", label: "타부서" },
        { key: "leader", label: "보직자" },
      ],
    },
    baseLevels: {
      administration: { default: 3 },
      research: { junior: 1, colleague: 2, otherDept: 3, leader: 3 },
    },
    identities: {
      research: {
        junior: { name: "김 연구원", role: "후배" },
        colleague: { name: "박 선임연구원", role: "동료" },
        otherDept: { name: "이 담당자", role: "타부서 담당자" },
        leader: { name: "최 팀장", role: "보직자" },
      },
      administration: {
        junior: { name: "김 담당", role: "후배" },
        colleague: { name: "박 선임", role: "동료" },
        otherDept: { name: "이 담당자", role: "타부서 담당자" },
        leader: { name: "최 팀장", role: "보직자" },
      },
    },
    roleContexts: {
      administration: "당신은 행정직으로 연구지원과 기관 운영 업무를 담당하며, 규정과 부서 간 조율을 함께 고려해야 합니다.",
      lead: "당신은 연구직 과제책임자로서 일정·품질·자원 배분에 관한 실무 결정을 맡고 있습니다. 과제책임자는 보직 여부와 무관한 과제 내 역할입니다.",
      member: "당신은 연구직 과제참여자로서 담당 분야의 전문 의견은 제시할 수 있지만, 예산·인력의 최종 결정권은 갖고 있지 않습니다.",
    },
    relationshipSuffixes: {
      junior: " 최근 함께 업무를 맡은 후배로, 평소 당신의 업무 안내를 받아 왔습니다.",
      colleague: " 비슷한 책임 범위를 가진 동료로, 여러 차례 업무를 조율해 왔습니다.",
      otherDept: " 다른 부서의 담당자로, 서로의 절차와 우선순위가 달라 조율이 필요한 관계입니다.",
      leader: " 일정·예산·인력에 영향력을 가진 보직자로, 최종 승인 권한을 바탕으로 제약을 제시할 수 있습니다.",
    },
    guidance: {
      administration: "역할 기준: 규정 준수, 담당 부서의 권한, 승인 절차를 확인하면서 조정안을 제시하세요.",
      lead: "역할 기준: 과제책임자로서 결정 근거와 책임 범위를 명확히 남기세요.",
      member: "역할 기준: 직접 결정할 범위와 과제책임자에게 승인 요청할 범위를 구분하세요.",
    },
    member: {
      authorityCue: "과제참여자 권한 안내: 아래 선택은 실행안을 제안하는 대화입니다. 예산·인력·일정의 최종 확정은 과제책임자에게 별도로 승인 요청하는 것으로 간주합니다.",
      // [화면 미노출] feedback.js의 미사용 객체에만 기록된다.
      authorityNote: "과제참여자는 직접 확정할 수 있는 범위와 과제책임자에게 승인 요청할 범위를 구분해야 합니다.",
      dialogueReplacements: [
        ["최종 지시를 주세요.", "제안할 실행안과 과제책임자 승인 요청 사항을 구분해 주세요."],
        ["지금 확정해 주세요.", "어떤 안으로 과제책임자에게 승인 요청할지 정해 주세요."],
      ],
    },
    leaderDialogueReplacements: [
      ["저희 권한으로는 확정할 수 없습니다.", "제 권한으로 긴급 집행 여부를 판단할 수 있지만, 비용 책임과 사후 보고 조건이 필요합니다."],
      ["부서장에게 바로 연락도 안 되는 상황인데, 그 책임을 제가 단독으로 질 수는 없습니다.", "제가 승인하려면 비용 책임과 사후 보고 방식을 명확히 해야 합니다."],
      ["전산 쪽 전담 인력은 저 한 명이고", "현재 배정 가능한 전산 인력은 한 명뿐이고"],
      ["저희는 승인번호 없이 업체에 발주할 권한이 없습니다.", "승인번호 없이 업체 발주를 허용할 수는 없습니다."],
      ["연구책임자 일정은 제가 직접 잡을 권한이 없어서", "연구책임자 일정은 제가 조정을 지시할 수 있지만 당사자 확인이 필요해서"],
      ["최종 지시를 주세요.", "승인을 검토할 수 있도록 최종 실행안을 제시해 주세요."],
    ],
  };
})();
