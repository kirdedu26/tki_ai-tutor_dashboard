/*
 * TKI 갈등 코치 — 교수자 대시보드
 * 학습자 튜터가 종합 화면에서 전송한 익명 결과(Google Apps Script → Sheet)를
 * doGet(JSON 배열)으로 읽어와 코호트 단위로 집계·시각화한다.
 *
 * 데이터 사전(유형·결말·프로파일 라벨)은 튜터와 동일한 window.TKI를 재사용한다.
 * 개인 식별 정보는 수집하지 않으며, 모든 지표는 반 전체 경향(익명) 기준이다.
 */
(function () {
  "use strict";

  var D = window.TKI;
  var root = document.getElementById("dash");

  // 튜터 앱과 동일한 엔드포인트(GET = 조회). 저장은 학습자 앱의 POST가 담당.
  var ENDPOINT = "https://script.google.com/macros/s/AKfycbzGWcr-3Y_KhBngewiE5POu6iGd8dlVMPD1b0S0MwSx8UjKcS9W2U7IugfBTbBLYyt2vQ/exec";

  var beatLabels = { 1: "쟁점 정의", 2: "대응 조정", 3: "실행 합의" };

  /* ------------------------------- 유틸 ------------------------------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function fitVal(fit) { return fit === "good" ? 1 : fit === "poor" ? -1 : 0; }
  function pct(part, total) { return total ? Math.round((part / total) * 100) : 0; }
  function typeLabel(k) { return (D.types[k] && D.types[k].label) || k || "—"; }
  function endingLabel(k) { return (D.endings[k] && D.endings[k].label) || k || "—"; }
  function endingTone(k) { return (D.endings[k] && D.endings[k].tone) || "mid"; }
  function optLabel(group, key) {
    var arr = (D.profiles && D.profiles.options && D.profiles.options[group]) || [];
    for (var i = 0; i < arr.length; i++) if (arr[i].key === key) return arr[i].label;
    return key || "—";
  }
  function toneColor(tone) {
    return tone === "good" ? "var(--good)" : tone === "warn" ? "var(--warn)"
      : tone === "bad" ? "var(--bad)" : "var(--brand)";
  }
  function fmtDate(iso) {
    // Date.parse만 사용(로케일 포맷은 브라우저에 위임). 실패 시 원문 앞부분.
    var t = Date.parse(iso);
    if (isNaN(t)) return String(iso || "").slice(0, 10);
    var d = new Date(t);
    function p2(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "." + p2(d.getMonth() + 1) + "." + p2(d.getDate());
  }
  function getToken() {
    var m = String(location.hash || location.search).match(/token=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }

  /* ---------------------------- 데이터 집계 ---------------------------- */
  function analyze(records) {
    var A = {
      sessions: records.length,
      practices: 0,
      decisions: 0,
      dateMin: null, dateMax: null,
      scoreSum: {}, scoreN: 0, legacyScoreN: 0,
      bandByType: {}, hasHighN: 0, hasLowN: 0,
      domCount: {}, tieCount: 0,
      fit: { good: 0, ok: 0, poor: 0 },
      fitByStage: { 1: z(), 2: z(), 3: z() },
      fitByMode: {},
      endings: {},
      byTarget: {},
      byOpponent: {},
      matchDecisions: 0, totalDecisions: 0, distinctSum: 0,
      jobCount: {}, opponentCount: {},
    };
    function z() { return { good: 0, ok: 0, poor: 0 }; }
    D.order.forEach(function (k) { A.scoreSum[k] = 0; A.domCount[k] = 0; A.bandByType[k] = { high: 0, mid: 0, low: 0 }; });

    records.forEach(function (r) {
      // 제출 기간
      var t = Date.parse(r.submittedAt);
      if (!isNaN(t)) {
        if (A.dateMin == null || t < A.dateMin) A.dateMin = t;
        if (A.dateMax == null || t > A.dateMax) A.dateMax = t;
      }
      // 진단 백분위 평균 + 우세 유형 분포
      // scoreScale이 "percentile"인 기록만 집계한다(구버전 원점수 0~12와 스케일이 달라 섞을 수 없음).
      var hasPct = !!(r.scores && typeof r.scores === "object" && r.scoreScale === "percentile");
      if (r.scores && typeof r.scores === "object" && !hasPct) A.legacyScoreN += 1;
      if (hasPct) {
        A.scoreN += 1;
        var maxv = -Infinity, anyHigh = false, anyLow = false;
        D.order.forEach(function (k) {
          var v = +r.scores[k] || 0;
          var bk = bandKey(v);
          A.scoreSum[k] += v;
          A.bandByType[k][bk] += 1;
          if (bk === "high") anyHigh = true;
          if (bk === "low") anyLow = true;
          if (v > maxv) maxv = v;
        });
        var tops = D.order.filter(function (k) { return (+r.scores[k] || 0) === maxv; });
        if (tops.length === 1) A.domCount[tops[0]] += 1; else A.tieCount += 1;
        // 공식 TKI 해석 범주를 사람 단위로 센다(평균 내지 않음 — TKI는 상대 척도라 합산·평균이 무의미)
        if (anyHigh) A.hasHighN += 1;
        if (anyLow) A.hasLowN += 1;
      }
      // 프로파일 분포
      if (r.profile) {
        A.jobCount[r.profile.job] = (A.jobCount[r.profile.job] || 0) + 1;
        A.opponentCount[r.profile.recentOpponent] = (A.opponentCount[r.profile.recentOpponent] || 0) + 1;
      }
      // 실습·결정 단위 집계
      var topSet = {};
      if (hasPct) {
        var mv = Math.max.apply(null, D.order.map(function (k) { return +r.scores[k] || 0; }));
        D.order.forEach(function (k) { if ((+r.scores[k] || 0) === mv) topSet[k] = true; });
      }
      var distinctModes = {};
      (r.practices || []).forEach(function (p) {
        A.practices += 1;
        // 결말 분포
        A.endings[p.endingKey] = (A.endings[p.endingKey] || 0) + 1;
        // 타깃/상대별 집계 버킷
        var bt = A.byTarget[p.target] || (A.byTarget[p.target] = { n: 0, good: 0, ok: 0, poor: 0, endings: {} });
        var bo = A.byOpponent[p.opponentType] || (A.byOpponent[p.opponentType] = { n: 0, good: 0, ok: 0, poor: 0, endings: {} });
        bt.n += 1; bo.n += 1;
        bt.endings[p.endingKey] = (bt.endings[p.endingKey] || 0) + 1;
        bo.endings[p.endingKey] = (bo.endings[p.endingKey] || 0) + 1;
        (p.decisions || []).forEach(function (dc) {
          A.decisions += 1;
          // 진단↔행동 대조는 백분위 기록에서만 분모로 잡는다.
          if (hasPct) A.totalDecisions += 1;
          var f = dc.fit === "good" || dc.fit === "poor" ? dc.fit : "ok";
          A.fit[f] += 1;
          if (A.fitByStage[dc.stage]) A.fitByStage[dc.stage][f] += 1;
          var fm = A.fitByMode[dc.mode] || (A.fitByMode[dc.mode] = z());
          fm[f] += 1;
          bt[f] += 1; bo[f] += 1;
          if (hasPct && topSet[dc.mode]) A.matchDecisions += 1;
          distinctModes[dc.mode] = true;
        });
      });
      A.distinctSum += Object.keys(distinctModes).length;
    });
    return A;
  }

  /* ------------------------------- 뷰 조각 ------------------------------- */
  function kpi(n, label, hint) {
    return '<div class="kpi"><div class="n">' + n + '</div><div class="l">' + esc(label) + '</div>' +
      (hint ? '<div class="h">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function barList(items, maxVal, suffix) {
    var max = maxVal || Math.max.apply(null, items.map(function (i) { return i.value; }).concat([1]));
    return '<ul class="dbars">' + items.map(function (it) {
      var w = max ? Math.round((it.value / max) * 100) : 0;
      return '<li><span class="dbar-lbl">' + esc(it.label) + '</span>' +
        '<span class="dbar-track"><span class="dbar-fill" style="width:' + w + '%' +
        (it.color ? ';background:' + it.color : '') + '"></span></span>' +
        '<span class="dbar-val">' + esc(it.display != null ? it.display : it.value + (suffix || '')) + '</span></li>';
    }).join('') + '</ul>';
  }

  function fitBar(f, height) {
    var t = f.good + f.ok + f.poor || 1;
    var h = height ? ' style="height:' + height + 'px"' : '';
    return '<span class="fitbar"' + h + '>' +
      '<span class="s-good" style="width:' + (f.good / t * 100) + '%"></span>' +
      '<span class="s-ok" style="width:' + (f.ok / t * 100) + '%"></span>' +
      '<span class="s-poor" style="width:' + (f.poor / t * 100) + '%"></span></span>';
  }

  function fitLegend() {
    return '<div class="legend">' +
      '<span><i style="background:var(--good)"></i>상황에 잘 맞물림</span>' +
      '<span><i style="background:#9aa0a6"></i>중립</span>' +
      '<span><i style="background:var(--bad)"></i>마찰 유발</span></div>';
  }

  // 규준(밴드) 해석 — TKI 공식 프로파일 기준: 75번째 백분위 이상 높음 / 25번째 이하 낮음 (튜터 app.js와 동일)
  function bandKey(p) { return p >= 75 ? "high" : p <= 25 ? "low" : "mid"; }

  // 높음/중간/낮음 3분할 막대 (.fitbar 스타일 재사용)
  function bandBar(b) {
    var t = b.high + b.mid + b.low || 1;
    return '<span class="fitbar">' +
      '<span style="width:' + (b.high / t * 100) + '%;background:var(--brand)"></span>' +
      '<span style="width:' + (b.mid / t * 100) + '%;background:#9aa0a6"></span>' +
      '<span style="width:' + (b.low / t * 100) + '%;background:#d9dbe0"></span></span>';
  }
  // 특정 밴드(high/low) 인원이 가장 많은 유형 (없으면 null)
  function mostBand(A, which) {
    var best = null;
    D.order.forEach(function (k) {
      if (A.bandByType[k][which] && (!best || A.bandByType[k][which] > A.bandByType[best][which])) best = k;
    });
    return best;
  }
  function bandLegend() {
    return '<div class="legend">' +
      '<span><i style="background:var(--brand)"></i>높음 75+</span>' +
      '<span><i style="background:#9aa0a6"></i>중간 25–75</span>' +
      '<span><i style="background:#d9dbe0"></i>낮음 0–25</span></div>';
  }

  // 유형별 도넛 색상 (범주형 팔레트)
  var TYPE_COLOR = {
    competing: "#e2685f", collaborating: "#6a5fd6", compromising: "#e8a13c",
    avoiding: "#8a90a6", accommodating: "#2fb3a0"
  };
  var JOB_COLOR = { research: "#5e53ca", administration: "#2fb3a0" };
  var OPP_COLOR = { junior: "#2fb3a0", colleague: "#6a5fd6", otherDept: "#e8a13c", leader: "#e2685f" };

  // 프로파일 항목(직군·갈등 상대) 분포 도넛 카드 — 튜터 옵션 순서대로, 없는 값은 제외
  function profileDonutCard(title, group, counts, colors, calloutLead) {
    var opts = (D.profiles && D.profiles.options && D.profiles.options[group]) || [];
    var items = opts.filter(function (o) { return counts[o.key]; }).map(function (o) {
      return { label: o.label, value: counts[o.key], color: colors[o.key] || "#9aa0a6" };
    }).sort(function (a, b) { return b.value - a.value; });
    var total = items.reduce(function (s, i) { return s + i.value; }, 0);
    return '<div class="card"><h2>' + esc(title) + '</h2>' +
      '<p class="desc">완료 세션 기준 · ' + total + '명</p>' +
      (total ? donut(items, total) +
        '<p class="callout">' + calloutLead + ' <b>' + esc(items[0].label) + '</b> — ' + pct(items[0].value, total) + '% (' + items[0].value + '명)</p>'
        : '<p class="desc">응답 데이터가 아직 없어요.</p>') +
      '</div>';
  }

  function statCard(icon, label, valueHtml, sub, dir) {
    return '<div class="stat">' +
      '<div class="stat-ic">' + icon + '</div>' +
      '<div class="stat-l">' + esc(label) + '</div>' +
      '<div class="stat-n">' + valueHtml + '</div>' +
      '<div class="stat-s ' + (dir || '') + '">' + sub + '</div></div>';
  }

  // 도넛 차트 — items:[{label,value,color}], 가운데 총계 + 우측 범례(%/명)
  function donut(items, total) {
    var R = 62, sw = 22, C = 2 * Math.PI * R, off = 0, cx = 80, cy = 80;
    var segs = items.map(function (it) {
      var len = (total ? it.value / total : 0) * C;
      var s = '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="none" stroke="' + it.color +
        '" stroke-width="' + sw + '" stroke-dasharray="' + len.toFixed(2) + ' ' + (C - len).toFixed(2) +
        '" stroke-dashoffset="' + (-off).toFixed(2) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
      off += len; return s;
    }).join("");
    var legend = items.map(function (it) {
      return '<li><span class="dot" style="background:' + it.color + '"></span>' +
        '<span class="lg-l">' + esc(it.label) + '</span>' +
        '<span class="lg-p">' + (total ? Math.round(it.value / total * 100) : 0) + '%</span>' +
        '<span class="lg-c">' + it.value + '명</span></li>';
    }).join("");
    return '<div class="donut-wrap">' +
      '<svg viewBox="0 0 160 160" class="donut" role="img" aria-label="갈등 유형 분포 도넛">' +
      '<circle cx="80" cy="80" r="' + R + '" fill="none" stroke="#eef0f3" stroke-width="' + sw + '"/>' +
      segs +
      '<text x="80" y="76" text-anchor="middle" class="donut-n">' + total + '</text>' +
      '<text x="80" y="94" text-anchor="middle" class="donut-t">명</text></svg>' +
      '<ul class="donut-legend">' + legend + '</ul></div>';
  }

  function radar(vals, scale) {
    var order = D.order, n = order.length, cx = 170, cy = 152, R = 92, max = scale || 100;
    function pt(i, r) {
      var a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    }
    function poly(r) {
      return order.map(function (_, i) { return pt(i, r).map(function (v) { return v.toFixed(1); }).join(","); }).join(" ");
    }
    var rings = [R / 3, (2 * R) / 3, R].map(function (r) {
      return '<polygon points="' + poly(r) + '" fill="none" stroke="#dde2ea" stroke-width="1"/>';
    }).join("");
    var axes = order.map(function (_, i) {
      var p = pt(i, R);
      return '<line x1="' + cx + '" y1="' + cy + '" x2="' + p[0].toFixed(1) + '" y2="' + p[1].toFixed(1) + '" stroke="#e6eaf1" stroke-width="1"/>';
    }).join("");
    var vpts = order.map(function (k, i) { return pt(i, Math.max(0, Math.min(1, (vals[k] || 0) / max)) * R); });
    var shape = '<polygon points="' + vpts.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" ") +
      '" fill="rgba(94,83,202,0.14)" stroke="var(--brand)" stroke-width="1.7" stroke-linejoin="round"/>';
    var dots = vpts.map(function (p) {
      return '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="3" fill="#fff" stroke="var(--brand)" stroke-width="1.7"/>';
    }).join("");
    var labels = order.map(function (k, i) {
      var p = pt(i, R + 16);
      var anchor = Math.abs(p[0] - cx) < 8 ? "middle" : p[0] > cx ? "start" : "end";
      var dy = p[1] < cy - 8 ? -4 : p[1] > cy + 8 ? 12 : 5;
      return '<text x="' + p[0].toFixed(1) + '" y="' + (p[1] + dy).toFixed(1) + '" text-anchor="' + anchor +
        '" class="radar-lbl">' + typeLabel(k) + ' <tspan class="radar-num">' + (vals[k] || 0).toFixed(1) + '</tspan></text>';
    }).join("");
    return '<svg viewBox="0 0 340 312" role="img" aria-label="코호트 유형별 평균 백분위 레이더 차트">' +
      rings + axes + shape + dots + labels + "</svg>";
  }

  function miniFit(f) {
    var t = f.good + f.ok + f.poor || 1;
    return '<span class="minifit">' +
      '<span style="width:' + (f.good / t * 100) + '%;background:var(--good)"></span>' +
      '<span style="width:' + (f.ok / t * 100) + '%;background:#9aa0a6"></span>' +
      '<span style="width:' + (f.poor / t * 100) + '%;background:var(--bad)"></span></span>';
  }

  /* ------------------------------- 렌더 ------------------------------- */
  var activeTab = "analysis"; // 리렌더·새로고침에도 선택 탭 유지

  function renderShell(analysisHtml, sessionsHtml, meta) {
    var tabbed = sessionsHtml != null;
    var nav = tabbed
      ? '<div class="tabs-nav" role="tablist">' +
        '<button class="tab-btn' + (activeTab === "analysis" ? " active" : "") + '" data-tab="analysis" role="tab">학습자 활용 결과 분석</button>' +
        '<button class="tab-btn' + (activeTab === "sessions" ? " active" : "") + '" data-tab="sessions" role="tab">학습자별 선택 현황 (익명)</button>' +
        '</div>'
      : "";
    var panels = tabbed
      ? '<div class="tabpanel" data-panel="analysis"' + (activeTab === "analysis" ? "" : " hidden") + '>' + analysisHtml + '</div>' +
        '<div class="tabpanel" data-panel="sessions"' + (activeTab === "sessions" ? "" : " hidden") + '>' + sessionsHtml + '</div>'
      : analysisHtml;
    root.innerHTML =
      '<div class="dash-top">' +
      '<div class="dash-brand"><span class="mark">TKI</span>' +
      '<span class="t">' + esc((D.copy && D.copy.brand) || "갈등 대응 코치") + '</span>' +
      '<span class="s">· 교수자 대시보드</span></div>' +
      '<div class="dash-actions">' +
      (meta ? '<span class="dmeta">' + meta + '</span>' : '') +
      '<button class="dbtn" id="csvbtn" title="원본 데이터를 엑셀 피벗용 CSV로 내려받기 (결정 하나가 한 행 · 미완료 세션 포함)">↓ CSV 내보내기</button>' +
      '<button class="dbtn" id="refresh">새로고침</button>' +
      '<button class="dbtn danger" id="resetbtn" title="수집된 모든 결과 삭제(테스트 데이터 정리) — 되돌릴 수 없음">데이터 초기화</button></div>' +
      '</div>' +
      '<h1>학습자 활용 결과</h1>' +
      '<p class="dash-sub">학습자 튜터에서 수집된 <b>익명</b> 실습 결과입니다. 정답을 채점하지 않고 대응 레퍼토리·유연성·상황별 경향을 관찰하는 관점으로 구성했으며, 개인 식별 정보는 수집하지 않습니다.</p>' +
      nav + panels;
    var btn = document.getElementById("refresh");
    if (btn) btn.addEventListener("click", load);
    var cbtn = document.getElementById("csvbtn");
    if (cbtn) cbtn.addEventListener("click", exportCsv);
    var rbtn = document.getElementById("resetbtn");
    if (rbtn) rbtn.addEventListener("click", resetData);
    Array.prototype.forEach.call(root.querySelectorAll(".tab-btn"), function (b) {
      b.addEventListener("click", function () { switchTab(b.getAttribute("data-tab")); });
    });
  }

  function switchTab(name) {
    activeTab = name;
    Array.prototype.forEach.call(root.querySelectorAll(".tab-btn"), function (b) {
      b.classList.toggle("active", b.getAttribute("data-tab") === name);
    });
    Array.prototype.forEach.call(root.querySelectorAll(".tabpanel"), function (p) {
      p.hidden = p.getAttribute("data-panel") !== name;
    });
  }

  function renderEmpty(msg) {
    renderShell('<div class="card"><div class="state-msg">' + esc(msg) + '</div></div>');
  }

  // 시작 이벤트와 완료 결과를 분리하고 id로 중복 제거해 완료율을 계산한다.
  function splitRecords(records) {
    var startedSet = {}, startRec = {}, completedMap = {}, completedNoId = [];
    records.forEach(function (r) {
      if (!r || typeof r !== "object") return;
      var hasPractices = Array.isArray(r.practices) && r.practices.length > 0;
      if (r.id) startedSet[r.id] = true;
      if (hasPractices) {
        if (r.id) completedMap[r.id] = r; else completedNoId.push(r);
      } else if (r.id && !startRec[r.id]) {
        startRec[r.id] = r; // 시작 신호 — 완료 세션의 소요 시간 계산과 CSV 미완료 행의 원본
      }
    });
    var completed = Object.keys(completedMap).map(function (k) { return completedMap[k]; }).concat(completedNoId);
    return {
      completed: completed,
      startRec: startRec,
      // 시작만 하고 종합 화면까지 가지 않은 세션. 화면 집계에는 쓰지 않고 CSV에만 한 행씩 남긴다.
      incomplete: Object.keys(startRec).filter(function (k) { return !completedMap[k]; })
        .map(function (k) { return startRec[k]; }),
      startedCount: Object.keys(startedSet).length + completedNoId.length,
      completedCount: completed.length,
    };
  }

  // CSV 내보내기용 (최근 로드된 원본)
  var lastCompleted = [], lastIncomplete = [], lastStartRec = {};

  function render(records) {
    records = Array.isArray(records) ? records : [];
    if (!records.length) {
      renderEmpty("아직 수집된 결과가 없습니다. 학습자가 실습을 시작·완료하면 여기에 집계됩니다.");
      return;
    }
    var split = splitRecords(records);
    lastCompleted = split.completed; // CSV 내보내기용
    lastIncomplete = split.incomplete;
    lastStartRec = split.startRec;
    if (!split.completed.length) {
      renderEmpty(split.startedCount + "명이 시작했지만, 아직 종합 화면까지 완료한 세션이 없습니다.");
      return;
    }
    var A = analyze(split.completed);
    var completionRate = pct(split.completedCount, split.startedCount);
    var meta = A.dateMin ? fmtDate(new Date(A.dateMin).toISOString()) + " – " + fmtDate(new Date(A.dateMax).toISOString()) : "";

    // 대응 유형별 선택 횟수(레퍼토리) · 유연성 · 진단↔행동 사용률
    var usage = {}; D.order.forEach(function (k) { usage[k] = sumFit(A.fitByMode[k]); });
    var unused = D.order.filter(function (k) { return !usage[k]; });
    var usageRate = pct(A.matchDecisions, A.totalDecisions);
    var avgDistinct = A.sessions ? (A.distinctSum / A.sessions) : 0;

    var html = "";

    // ── 학습 현황 한눈에 (하루치 단일 세션: 지표 카드 + 유형 도넛) ──
    html += '<div class="sec-label">학습 현황 한눈에</div>';
    html += '<div class="statgrid">' +
      statCard("●", "완료 학습자", split.completedCount + '<span class="unit">명</span>', "익명 집계", "") +
      statCard("✓", "완료율", completionRate + '<span class="unit">%</span>', "시작 " + split.startedCount + "명 중", "") +
      statCard("◆", "평균 실습 완료", (A.sessions ? (A.practices / A.sessions).toFixed(1) : "0") + '<span class="unit">개</span>',
        "총 " + A.practices + "개 실습", "") +
      (A.scoreN
        ? statCard("▲", "규준 대비 ‘높음’ 유형 보유", A.hasHighN + '<span class="unit">명</span>',
            "백분위 입력 " + A.scoreN + "명 중 " + pct(A.hasHighN, A.scoreN) + "%", "")
        : statCard("▲", "규준 대비 ‘높음’ 유형 보유", "—", "백분위 입력 데이터 없음", "")) +
      '</div>';

    html += '<div class="fine-note">' +
      '<p><b>완료율</b> — 실습을 시작(첫 실습 진입)한 인원 중 종합 화면까지 끝낸 비율이에요. 시작 신호 도입 이전 완료 세션은 완료로만 잡혀 도입 초기엔 높게 보일 수 있어요.</p>' +
      '<p><b>규준 대비 &lsquo;높음&rsquo; 유형 보유</b> — 학습자가 입력한 TKI 백분위에서, 다섯 유형 중 하나라도 <b>75 이상(규준집단 상위 25%)</b>인 사람 수예요. ' +
      'TKI 공식 해석에서 상위 25%는 &lsquo;그 방식을 다른 사람들보다 자주 택한다&rsquo;는 뜻이고, 그 방식을 <b>과하게 쓰고 있지 않은지 점검해볼 후보</b>로 봐요. 좋고 나쁨의 판정이 아니에요. ' +
      '(아래 &lsquo;규준 대비 밴드 분포&rsquo;에서 어느 유형인지 확인할 수 있어요.)' +
      (A.legacyScoreN ? ' 원점수로 입력된 구버전 기록 ' + A.legacyScoreN + '건은 제외했어요.' : '') + '</p>' +
      '</div>';

    // 갈등 유형 · 직군 · 최근 부담 갈등 상대 분포 (도넛 3개)
    var donutItems = D.order.filter(function (k) { return A.domCount[k]; }).map(function (k) {
      return { label: typeLabel(k), value: A.domCount[k], color: TYPE_COLOR[k] };
    }).sort(function (a, b) { return b.value - a.value; });
    if (A.tieCount) donutItems.push({ label: "동점", value: A.tieCount, color: "#cfd3da" });
    var domTotal = donutItems.reduce(function (a, i) { return a + i.value; }, 0);
    html += '<div class="grid3">' +
      '<div class="card"><h2>갈등 유형 분포</h2>' +
      '<p class="desc">진단 최고 백분위 유형 기준 · ' + domTotal + '명' + (A.legacyScoreN ? ' (구버전 ' + A.legacyScoreN + '건 제외)' : '') + '</p>' +
      (domTotal ? donut(donutItems, domTotal) +
        '<p class="callout">가장 많은 유형은 <b>' + donutItems[0].label + '</b> — ' + pct(donutItems[0].value, domTotal) + '% (' + donutItems[0].value + '명)</p>'
        : '<p class="desc">백분위 진단 데이터가 아직 없어요.</p>') +
      '</div>' +
      profileDonutCard("직군 분포", "job", A.jobCount, JOB_COLOR, "가장 많은 직군은") +
      profileDonutCard("최근 부담되었던 갈등 상대", "opponent", A.opponentCount, OPP_COLOR, "가장 많이 꼽힌 상대는") +
      '</div>';

    // ── 전체 현황 한눈에 — 참여(KPI) 다음으로 '무엇을 골랐고 어떻게 끝났나'를 먼저 보여준다 ──
    var repItems = D.order.map(function (k) {
      return { label: typeLabel(k), value: usage[k], display: usage[k] + "회", color: usage[k] ? "var(--brand)" : "#d9dbe0" };
    });
    var endOrder = ["resolved", "partial", "patched", "stuck"];
    var endKeys = endOrder.filter(function (k) { return A.endings[k]; })
      .concat(Object.keys(A.endings).filter(function (k) { return endOrder.indexOf(k) < 0; }));
    var endItems = endKeys.map(function (k) {
      return { label: endingLabel(k), value: A.endings[k], display: A.endings[k] + "회 (" + pct(A.endings[k], A.practices) + "%)", color: toneColor(endingTone(k)) };
    });
    html += '<div class="sec-label">실습 선택 현황</div>' +
      '<div class="grid2">' +
      '<div class="card"><h2>대응 레퍼토리 — 무엇을 골랐나</h2>' +
      '<p class="desc">전체 ' + A.decisions + '개 결정에서 다섯 대응 방식이 각각 몇 번 선택됐는지. 많고 적음이 좋고 나쁨은 아니고, 튜터의 메시지는 &lsquo;덜 쓰는 카드 넓히기&rsquo;예요.</p>' +
      barList(repItems) +
      (unused.length ? '<p class="desc" style="margin:12px 0 0">한 번도 안 꺼낸 방식: <b>' + unused.map(typeLabel).join("·") + '</b></p>' : '') +
      '</div>' +
      '<div class="card"><h2>결말 경향 — 어떻게 끝났나</h2>' +
      '<p class="desc">전체 ' + A.practices + '개 대화가 어디까지 갔는지. 성적이 아니라 토론 소재로 보세요 — 봉합·교착이 많으면 &lsquo;합의까지 끌고 가는 힘&rsquo;을 다룰 지점입니다.</p>' +
      barList(endItems) + '</div>' +
      '</div>';

    // 학습자별 선택 현황 (익명) — 세션 하나 = 익명 학습자 1명, 무엇을 골랐고 어떻게 끝났나
    var sess = split.completed.slice().sort(function (a, b) {
      return (Date.parse(b.submittedAt) || 0) - (Date.parse(a.submittedAt) || 0);
    });
    var sessShown = sess.slice(0, 200);
    var sessRows = sessShown.map(function (r) {
      var sc = r.scores || {}, isPct = r.scoreScale === "percentile";
      var dk = domTypeOf(sc);
      var dv = dk ? +sc[dk] : null;
      var bandTxt = (isPct && dv != null) ? { high: "높음", mid: "중간", low: "낮음" }[bandKey(dv)] : "";
      var domCell = dk ? esc(typeLabel(dk)) + (bandTxt ? ' <span class="chip band-' + bandKey(dv) + '">' + bandTxt + '</span>' : '') : "—";
      // 규준 대비 높음(75+)·낮음(25−) 유형 — 공식 TKI 해석 범주 그대로 표기
      function bandTypes(which) {
        return D.order.filter(function (k) { var v = +sc[k]; return !isNaN(v) && bandKey(v) === which; }).map(typeLabel).join("·");
      }
      var highTxt = isPct ? (bandTypes("high") || "없음") : "—";
      var lowTxt = isPct ? (bandTypes("low") || "없음") : "—";
      var tm = topMode(r.practices);
      var dots = (r.practices || []).map(function (p) {
        return '<span class="edot" title="' + esc(endingLabel(p.endingKey)) + '" style="background:' + toneColor(endingTone(p.endingKey)) + '"></span>';
      }).join("");
      var jobRole = esc(optLabel("job", (r.profile || {}).job)) + ((r.profile || {}).projectRole ? "·" + esc(optLabel("projectRole", r.profile.projectRole)) : "");
      return '<tr><td class="mono">' + esc(r.id ? r.id.slice(-4) : "----") + '</td>' +
        '<td>' + jobRole + '</td>' +
        '<td>' + domCell + '</td>' +
        '<td class="band-cell">' + esc(highTxt) + '</td>' +
        '<td class="band-cell">' + esc(lowTxt) + '</td>' +
        '<td class="num">' + (r.practices || []).length + '</td>' +
        '<td>' + (tm ? esc(typeLabel(tm)) : "—") + '</td>' +
        '<td>' + dots + '</td>' +
        '<td class="num">' + (r.submittedAt ? fmtDate(r.submittedAt) : "—") + '</td></tr>';
    }).join("");
    var sessionsHtml = '<div class="card"><h2>학습자별 선택 현황 (익명)</h2>' +
      '<p class="desc">완료한 세션마다 무엇을 골랐고 어떻게 끝났는지. 이름·학번 없이 <b>익명 세션 코드</b>로만 표시합니다. (' + sessShown.length + '개 표시 / 총 ' + sess.length + '개) · 우측 상단 &lsquo;CSV 내보내기&rsquo;로 원본을 받을 수 있어요(미완료 세션과 소요 시간도 함께 들어갑니다).</p>' +
      '<div class="tablewrap"><table class="dtab"><thead><tr>' +
      '<th>세션</th><th>직군</th><th>진단 우세</th><th>높음 유형<br><span class="th-sub">상위 25%</span></th><th>낮음 유형<br><span class="th-sub">하위 25%</span></th><th class="num">실습</th><th>주요 대응</th><th>결말</th><th class="num">날짜</th>' +
      '</tr></thead><tbody>' + sessRows + '</tbody></table></div>' +
      '<div class="legend" style="margin-top:10px">' +
      '<span><i style="background:var(--good)"></i>원만히 해결</span>' +
      '<span><i style="background:var(--brand)"></i>부분 해결</span>' +
      '<span><i style="background:var(--warn)"></i>봉합</span>' +
      '<span><i style="background:var(--bad)"></i>교착</span>' +
      '<span class="lg-note">· 결말은 실습별 색 점(마우스오버 시 이름) · 높음/낮음 유형 = TKI 백분위 75 이상 / 25 이하(구버전 원점수 기록은 —)</span></div>' +
      '</div>';

    // 코호트 진단 프로파일 + 우세 유형 분포 (서술적)
    var avg = {};
    D.order.forEach(function (k) { avg[k] = A.scoreN ? A.scoreSum[k] / A.scoreN : 0; });
    var domItems = D.order.map(function (k) {
      return { label: typeLabel(k), value: A.domCount[k], display: A.domCount[k] + "명" };
    });
    if (A.tieCount) domItems.push({ label: "동점", value: A.tieCount, display: A.tieCount + "명", color: "#9aa0a6" });
    html += '<div class="sec-label">진단 프로파일 · 규준 대비</div>' +
      '<div class="grid2">' +
      '<div class="card"><h2>코호트 진단 프로파일</h2>' +
      '<p class="desc">유형마다 반 학습자들의 백분위(0–100)를 평균 낸 값이에요. 어느 유형이 정답이 아니라, 이 반이 지금 어디에 익숙한지를 보여줍니다. <b>유형별로 따로 읽으세요</b> — 다섯 값을 서로 더하거나 평균 내는 건 TKI에서 의미가 없어요.</p>' +
      (A.legacyScoreN ? '<p class="desc">※ 원점수(0–12)로 입력된 구버전 기록 ' + A.legacyScoreN + '건은 스케일이 달라 이 집계에서 제외했습니다.</p>' : '') +
      '<div class="radar-wrap">' + radar(avg) + '</div></div>' +
      '<div class="card"><h2>우세 유형 분포</h2>' +
      '<p class="desc">각 학습자의 진단 <b>최고 백분위 유형</b>이 반에서 얼마나 분포하는지 보여줍니다.' +
      '<br>※ 최고 백분위 유형이라도 규준상 &lsquo;중간·낮음&rsquo;일 수 있어요(순위 ≠ 밴드). 아래 <b>규준 대비 밴드 분포</b>와 함께 보세요.</p>' +
      barList(domItems) + '</div>' +
      '</div>';

    // 규준(밴드) 층위 — 백분위 기록만. TKI 공식 프로파일의 25·75 백분위 구분을 그대로 사용.
    if (A.scoreN) {
      var bandRows = D.order.map(function (k) {
        var b = A.bandByType[k];
        return '<div class="stage-row band-row"><span class="nm">' + typeLabel(k) + '</span>' +
          bandBar(b) + '<span class="pct band-cnt">높음 ' + b.high + ' · 중간 ' + b.mid + ' · 낮음 ' + b.low + '</span></div>';
      }).join("");
      var hiK = mostBand(A, "high"), loK = mostBand(A, "low");
      html += '<div class="card"><h2>규준 대비 밴드 분포</h2>' +
        '<p class="desc">유형별로 이 반 학습자가 규준집단 대비 <b>높음·중간·낮음</b> 중 어디에 있는지 사람 수로 셌어요. (' + A.scoreN + '명 기준' + (A.legacyScoreN ? ', 원점수 구버전 ' + A.legacyScoreN + '건 제외' : '') + ')</p>' +
        '<div class="band-layout">' +
        '<div>' + bandRows + bandLegend() +
        ((hiK || loK) ? '<p class="callout">' +
          (hiK ? '&lsquo;높음&rsquo;이 가장 많은 유형: <b>' + typeLabel(hiK) + '</b>(' + A.bandByType[hiK].high + '명)' : '') +
          (hiK && loK ? ' · ' : '') +
          (loK ? '&lsquo;낮음&rsquo;이 가장 많은 유형: <b>' + typeLabel(loK) + '</b>(' + A.bandByType[loK].low + '명)' : '') +
          '</p>' : '') +
        '</div>' +
        '<div class="howto">' +
        '<h3>이렇게 읽으세요</h3>' +
        '<p><b>이 수치는?</b> 학습자가 TKI 결과지에서 옮겨 적은 <b>백분위</b>예요. TKI를 표준화할 때 쓴 규준집단(직장인) 안에서의 위치로, 예컨대 경쟁형 80이면 &lsquo;규준집단의 80%보다 경쟁형을 더 자주 택한다&rsquo;는 뜻이에요.</p>' +
        '<p><b>밴드 구분</b> TKI 공식 프로파일은 25·75 백분위에 선을 그어 나눠요. <b>높음</b> = 75 이상(상위 25%), <b>중간</b> = 가운데 50%, <b>낮음</b> = 25 이하(하위 25%).</p>' +
        '<p><b>해석</b> 높음은 그 방식을 자주 꺼낸다는 뜻 — 강점이 될 수 있지만, 맞지 않는 상황에서도 쓰는 <b>과용</b>은 아닌지 점검해볼 후보예요. 낮음은 잘 안 꺼낸다는 뜻 — 그 방식이 필요한 상황에서 <b>덜 쓰고</b> 있지 않은지 점검해볼 후보예요.</p>' +
        '<p><b>주의</b> 밴드는 좋고 나쁨의 판정이 아니에요. 어떤 방식이 적절한지는 상황에 달려 있어요. 또 TKI는 한 사람 안에서 다섯 방식의 <b>상대적 선호</b>를 재는 척도(점수 합이 30으로 고정)라, 유형별 값을 더하거나 평균 내서 &lsquo;갈등 총량&rsquo;처럼 읽으면 안 돼요.</p>' +
        '<p><b>수업에서는</b> &lsquo;높음&rsquo;이 몰린 유형은 그 방식의 강점과 과용 신호를 함께 다루고, &lsquo;낮음&rsquo;이 몰린 유형은 그 방식이 효과적인 상황을 예시로 오늘의 연습 포인트로 삼아보세요.</p>' +
        '<p class="src">근거: TKI 공식 프로파일·해석 보고서(The Myers-Briggs Company), Kilmann Diagnostics TKI 해석 안내</p>' +
        '</div>' +
        '</div></div>';
    }

    // ── 자세히 보기 (진단↔행동 · 상황 · 단계) — 기본 접힘, 펼치면 계산 설명 ──
    html += '<details class="detail-fold"><summary>자세히 보기 — 심화 분석 지표 (펼쳐 보기)</summary>' +
      '<p class="calc-note">아래 지표는 튜터의 <b>상황 적합도 표시</b>(선택마다 그 상황에 &lsquo;잘 맞물림 / 중립 / 마찰&rsquo;)에서 파생돼요. <b>정답·오답 채점이 아닙니다.</b> 도입부 현황 파악에는 위 요약으로 충분하고, 더 깊이 볼 때만 펼쳐 참고하세요.</p>';

    // 진단 ↔ 행동 (자각의 재료 — 옳고 그름 아님)
    html += '<div class="card"><h2>진단 성향 &harr; 실제 대응</h2>' +
      '<p class="desc">진단으로 나온 성향이 실제 선택으로 이어졌는가, 그리고 얼마나 유연하게 다른 방식을 꺼냈는가. 격차 자체는 좋고 나쁨이 아니라 <b>자기 이해의 재료</b>입니다.</p>' +
      '<div class="bigstat">' +
      '<div class="item"><div class="n">' + usageRate + '%</div><div class="l">진단 최고 유형을 실제로 선택한 결정 비율</div></div>' +
      '<div class="item"><div class="n">' + avgDistinct.toFixed(1) + '</div><div class="l">1인당 평균 사용 대응 유형 수 (유연성 · 최대 5)</div></div>' +
      '</div>' +
      '<p class="desc" style="margin-top:16px;margin-bottom:0">비율이 낮으면 진단 성향과 다르게 움직인 것 — 상황에 맞춰 조정했을 수도, 진단 이해가 아직 얕을 수도 있어요. 유형 수가 많으면 상황 따라 대응을 바꾼 편입니다. &lsquo;왜 그랬는지&rsquo;를 학습자 스스로 답해보게 하는 게 이 지표의 쓰임새예요.</p>' +
      '<p class="calc-note">계산: 각 학습자의 <b>진단 최고 백분위 유형</b>과 실습에서 실제로 고른 대응을 비교해, 전체 결정 중 &lsquo;최고 유형을 고른 결정&rsquo; 비율을 냈어요. 오른쪽 수치는 1인이 쓴 <b>서로 다른 대응 유형 수</b>의 평균이에요. 둘 다 표준화된 TKI 척도가 아니라 <b>이번 실습 선택을 센 서술적 수치</b>로, TKI 모형이 강조하는 &lsquo;상황에 맞게 여러 방식을 쓰는 유연성&rsquo;을 가늠해보는 참고용입니다.</p>' +
      '</div>';

    // 상황별 대응 경향 (결과 층위: 대화가 어디까지 갔나)
    html += '<p class="calc-note">계산: 실습을 <b>연습 타깃 유형</b>·<b>갈등 상대</b>별로 묶어, 봉합·교착으로 끝난 비율이 높은(=마찰 큰) 순으로 정렬했어요. 오른쪽 &lsquo;원만·부분해결&rsquo;은 그 그룹에서 원만히/부분 해결로 끝난 실습 비율입니다.</p>';
    html += '<div class="grid2">' +
      situationCard("상황별 대응 경향 — 연습 타깃 유형", "연습한 대응 유형", A.byTarget, typeLabel) +
      situationCard("상황별 대응 경향 — 갈등 상대", "갈등 상대", A.byOpponent, function (k) { return optLabel("opponent", k); }) +
      '</div>';

    // (결말 경향은 상단 '전체 현황 한눈에'로 이동)

    // 상황 적합 경향 (참고) — fit을 채점이 아니라 '상황 요구와 얼마나 맞물렸나'로 demote
    var stageRows = [1, 2, 3].map(function (s) {
      var f = A.fitByStage[s], tot = f.good + f.ok + f.poor;
      return '<div class="stage-row"><span class="nm">' + beatLabels[s] + '</span>' +
        fitBar(f) + '<span class="pct">' + pct(f.good, tot) + '%</span></div>';
    }).join("");
    var modeRows = D.order.filter(function (k) { return A.fitByMode[k]; }).map(function (k) {
      var f = A.fitByMode[k], tot = f.good + f.ok + f.poor;
      return '<div class="stage-row"><span class="nm">' + typeLabel(k) + '</span>' +
        fitBar(f) + '<span class="pct">' + tot + '회</span></div>';
    }).join("");
    html += '<div class="ref-band"><div class="vb-label">상황 적합 경향 (참고 · 정답률 아님)</div>' +
      '<p class="desc" style="margin:0 0 12px">아래 두 지표는 각 대응이 <b>그 상황의 요구</b>와 얼마나 맞물렸는지의 경향입니다. 옳고 그름의 채점이 아니라, &lsquo;상황에 맞는 대응을 골랐는가&rsquo;를 참고로 보는 자료예요.</p>' +
      '<p class="calc-note">계산: 튜터는 학습자의 <b>선택 하나하나</b>에 그 상황의 요구에 맞으면 &lsquo;잘 맞물림&rsquo;, 어긋나면 &lsquo;마찰&rsquo;로 표시해요(상황 적합도, 정답 아님). 이걸 <b>단계</b>(쟁점 정의·대응 조정·실행 합의)별·<b>대응 유형</b>별로 모아 비율로 보여줍니다.</p>' +
      '<div class="grid2">' +
      '<div class="card"><h2>단계별 상황 적합 경향</h2>' +
      '<p class="desc">쟁점 정의 → 대응 조정 → 실행 합의 중 어느 단계에서 마찰이 늘어나는지. (우측 = 상황에 잘 맞물린 비율)</p>' +
      stageRows + fitLegend() + '</div>' +
      '<div class="card"><h2>대응 유형별 상황 적합 경향</h2>' +
      '<p class="desc">각 방식을 골랐을 때 상황과 얼마나 맞물렸는지. (우측 = 선택 횟수)</p>' +
      modeRows + fitLegend() + '</div>' +
      '</div></div></details>';

    // 교수자 피드백 제안 — 현황을 다 본 뒤의 실행 제안(맨 끝)
    var suggestions = coachSuggestions(A, usage, unused, avgDistinct, usageRate);
    html += '<div class="sec-label">교수자 피드백 제안</div>' +
      '<div class="card coach-card"><h2>이 반, 이렇게 짚어보세요</h2>' +
      '<p class="desc">위 현황에서 자동 도출한 <b>집단 피드백·토론 소재</b>입니다. 개인 채점이 아니라, 다음 수업에서 무엇을 함께 넓힐지 정하는 데 쓰세요.</p>' +
      '<ul class="coach-list">' + suggestions.map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ul></div>';

    // 푸터 (두 탭 공통)
    var footer = '<div class="dfoot">' +
      '데이터 출처: 학습자 튜터가 실습 시작·완료 시 전송한 익명 결과(Google Apps Script → Sheet). ' +
      '수집 항목: 진단 5유형 백분위, 프로파일(직군·역할·상대 유형), 실습별 타깃·상대·결말, 결정별 (단계·대응유형·상황 적합 경향). ' +
      '이름·학번 등 개인 식별 정보는 수집하지 않습니다.<br>' +
      '집계 기준 시작 ' + split.startedCount + '건 · 완료 ' + split.completedCount + '건' +
      (meta ? ' · 기간 ' + meta : '') + '.' +
      '</div>';
    html += footer;
    sessionsHtml += footer;

    renderShell(html, sessionsHtml, meta);
  }

  function sumFit(f) { return f ? f.good + f.ok + f.poor : 0; }

  // 세션별 가장 많이 고른 대응 유형
  function topMode(practices) {
    var c = {};
    (practices || []).forEach(function (p) { (p.decisions || []).forEach(function (d) { c[d.mode] = (c[d.mode] || 0) + 1; }); });
    var best = null, bv = -1;
    Object.keys(c).forEach(function (m) { if (c[m] > bv) { bv = c[m]; best = m; } });
    return best;
  }
  // 세션의 진단 최고 유형(argmax) — 스케일 무관(순위)
  function domTypeOf(scores) {
    if (!scores) return null;
    var dk = null, dv = -Infinity;
    D.order.forEach(function (k) { var v = +scores[k]; if (!isNaN(v) && v > dv) { dv = v; dk = k; } });
    return dk;
  }

  /* ── CSV 내보내기 (익명 · 결정 하나가 한 행 + 미완료 세션 한 행) ──
     엑셀 피벗을 전제로 만든다.

     · 값은 키가 아니라 사람이 읽는 라벨로 쓴다. 피벗 필드에 그대로 떠야 하기 때문.
     · 순서가 있는 항목(단계·결말·상황적합·밴드)은 앞에 숫자를 붙인다. 그러지 않으면
       피벗이 가나다순으로 늘어놓아 '교착'이 맨 앞에 온다.
     · 세션 정보는 9행, 실습 정보는 3행에 걸쳐 반복된다. 그대로 세면 3배·9배로 부푼다.
       그래서 '세션첫행'·'실습첫행'을 1/0으로 두었다. 피벗에서 이 열을 '합계'로 끌어다
       쓰면 중복 제거 없이 세션 수·실습 수가 바로 나온다. */
  function csvCell(v) {
    var s = v == null ? "" : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // 엑셀이 날짜·시각으로 알아보는 형식. ISO 문자열은 텍스트로 들어가 정렬이 깨진다.
  function csvTs(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    var d = new Date(t);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
      " " + p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
  }
  var STAGE_CSV = { 1: "1 쟁점 정의", 2: "2 대응 조정", 3: "3 실행 합의" };
  var FIT_CSV = { good: "1 잘 맞물림", ok: "2 중립", poor: "3 마찰" };
  var ENDING_CSV = { resolved: "1 원만히 해결", partial: "2 부분 해결", patched: "3 관계 손상 후 봉합", stuck: "4 교착" };
  var BAND_CSV = { high: "1 높음", mid: "2 중간", low: "3 낮음" };

  function csvOpt(group, key) { return key ? optLabel(group, key) : ""; }

  // 진단 최고 백분위 유형(동점이면 모두). 화면의 '진단↔행동' 계산과 같은 규칙.
  function topSetOf(r) {
    if (!r.scores || r.scoreScale !== "percentile") return null;
    var mv = Math.max.apply(null, D.order.map(function (k) { return +r.scores[k] || 0; }));
    var s = {};
    D.order.forEach(function (k) { if ((+r.scores[k] || 0) === mv) s[k] = true; });
    return s;
  }

  // 세션 층위 열(상태 ~ 밴드). 완료·미완료 모두 같은 모양으로 채운다.
  function csvSessionCols(r, status, startedIso) {
    var sc = r.scores || {}, pf = r.profile || {};
    var isPct = r.scoreScale === "percentile";
    var t0 = Date.parse(startedIso), t1 = Date.parse(r.submittedAt);
    var mins = (!isNaN(t0) && !isNaN(t1) && t1 >= t0) ? ((t1 - t0) / 60000).toFixed(1) : "";
    var dom = "";
    if (isPct) {
      var tops = Object.keys(topSetOf(r) || {});
      dom = tops.length === 1 ? typeLabel(tops[0]) : "동점";
    }
    return [status, r.id || "", csvTs(startedIso), csvTs(r.submittedAt), mins,
      isPct ? "백분위" : (r.scores ? "구버전 원점수" : ""),
      csvOpt("job", pf.job), csvOpt("projectRole", pf.projectRole), csvOpt("opponent", pf.recentOpponent)]
      .concat(D.order.map(function (k) { var v = +sc[k]; return isNaN(v) ? "" : v; }))
      .concat([dom])
      .concat(D.order.map(function (k) {
        var v = +sc[k]; return (isPct && !isNaN(v)) ? BAND_CSV[bandKey(v)] : "";
      }));
  }

  function exportCsv() {
    var done = lastCompleted || [], open = lastIncomplete || [];
    if (!done.length && !open.length) { alert("내보낼 데이터가 없습니다."); return; }
    var tl = D.order.map(typeLabel);
    var header = ["상태", "세션", "시작시각", "완료시각", "소요분", "척도", "직군", "과제역할", "최근 갈등상대"]
      .concat(tl).concat(["우세유형"]).concat(tl.map(function (l) { return "밴드_" + l; }))
      .concat(["실습번호", "시나리오키", "연습타깃", "상황목표", "난이도", "시작수위", "갈등상대", "결말", "실습소요초"])
      .concat(["단계", "대응", "상황적합", "우세유형선택", "세션첫행", "실습첫행"]);
    var lines = [header.join(",")];

    // 완료 세션 — 결정 하나가 한 행
    done.forEach(function (r) {
      var base = csvSessionCols(r, "완료", (lastStartRec[r.id] || {}).startedAt || "");
      var top = topSetOf(r), sessFirst = true;
      (r.practices || []).forEach(function (p, pi) {
        // 상황목표·난이도·시작수위는 시나리오에 고정된 값. 기록에 없으면 정의에서 가져온다.
        var def = (D.scenarios && D.scenarios[p.scenarioKey]) || {};
        var pcols = [pi + 1, p.scenarioKey || "", typeLabel(p.target),
          p.requires || def.requires || "", def.level || "", p.startState || def.startState || "",
          csvOpt("opponent", p.opponentType), ENDING_CSV[p.endingKey] || p.endingKey || "",
          p.durationSec == null ? "" : p.durationSec];
        var ds = (p.decisions && p.decisions.length) ? p.decisions : [null];
        var pracFirst = true;
        ds.forEach(function (d) {
          var dcols = d
            ? [STAGE_CSV[d.stage] || d.stage || "", typeLabel(d.mode), FIT_CSV[d.fit] || d.fit || "",
               top ? (top[d.mode] ? 1 : 0) : ""]
            : ["", "", "", ""];
          lines.push(base.concat(pcols, dcols, [sessFirst ? 1 : 0, pracFirst ? 1 : 0]).map(csvCell).join(","));
          sessFirst = false; pracFirst = false;
        });
      });
    });

    // 미완료 세션 — 한 행. 실습·결정 열은 비운다(완료율의 분모).
    open.forEach(function (r) {
      lines.push(csvSessionCols(r, "미완료", r.startedAt || "")
        .concat(["", "", "", "", "", "", "", "", ""], ["", "", "", ""], [1, 0]).map(csvCell).join(","));
    });

    var csv = "﻿" + lines.join("\r\n"); // BOM: Excel 한글 깨짐 방지
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    var url = URL.createObjectURL(blob), a = document.createElement("a");
    var d = new Date(); function p2(n) { return (n < 10 ? "0" : "") + n; }
    a.href = url;
    a.download = "tki-raw_" + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + ".csv";
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  // ── 데이터 초기화 (Apps Script의 토큰 검증된 reset 호출) ──
  function resetData() {
    if (!window.confirm("수집된 모든 결과(테스트 데이터 포함)를 삭제합니다.\n되돌릴 수 없습니다. 계속할까요?")) return;
    var token = window.prompt("초기화 암호를 입력하세요 (Apps Script에 설정한 RESET_TOKEN):");
    if (!token) return;
    var btn = document.getElementById("resetbtn");
    function reenable() { if (btn) { btn.disabled = false; btn.textContent = "데이터 초기화"; } }
    if (btn) { btn.disabled = true; btn.textContent = "초기화 중…"; }
    fetch(ENDPOINT + "?action=reset&token=" + encodeURIComponent(token), { method: "GET", cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (res && res.ok) { window.alert("초기화 완료: " + (res.cleared || 0) + "건 삭제됨."); load(); }
        else { window.alert("초기화 실패: " + ((res && res.error) || "암호가 틀렸거나 Apps Script가 아직 초기화 기능을 지원하지 않습니다.")); reenable(); }
      })
      .catch(function (e) { window.alert("초기화 요청 실패: " + e.message + "\nApps Script 배포·네트워크를 확인하세요."); reenable(); });
  }

  // 상황별 대응 경향 카드 — 결과(결말) 층위로 정렬·요약. fit은 참고용 미니바로만 표시.
  function situationCard(title, subject, buckets, labelFn) {
    var keys = Object.keys(buckets);
    function unres(x) { var e = buckets[x].endings || {}; return ((e.patched || 0) + (e.stuck || 0)) / (buckets[x].n || 1); }
    keys.sort(function (a, b) { return unres(b) - unres(a); }); // 봉합·교착 잦은(마찰 큰) 순
    var rows = keys.map(function (k) {
      var b = buckets[k], e = b.endings || {};
      var resolvedPct = pct((e.resolved || 0) + (e.partial || 0), b.n);
      return '<tr><td>' + esc(labelFn(k)) + '</td>' +
        '<td class="num">' + b.n + '</td>' +
        '<td>' + miniFit(b) + '</td>' +
        '<td class="num">' + resolvedPct + '%</td></tr>';
    }).join("");
    return '<div class="card"><h2>' + esc(title) + '</h2>' +
      '<p class="desc">' + esc(subject) + '별로 대화가 어떻게 흘렀는지. 봉합·교착이 잦은(=마찰 큰) 순으로 정렬했습니다. 가운데 &lsquo;상황 적합 경향&rsquo;은 참고용이며 정답률이 아닙니다.</p>' +
      '<table class="dtab"><thead><tr><th>항목</th><th class="num">실습</th><th>상황 적합 경향</th><th class="num">원만·부분해결</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>';
  }

  // 반 전체 경향 → 교수자가 바로 쓸 수 있는 집단 피드백/토론 문구 (비판단적)
  function coachSuggestions(A, usage, unused, avgDistinct, usageRate) {
    var s = [];
    var rare = D.order.slice().sort(function (a, b) { return usage[a] - usage[b]; });

    if (unused.length)
      s.push('<b>레퍼토리 넓히기</b> — 이 반은 ' + unused.map(typeLabel).join("·") +
        ' 방식을 한 번도 꺼내지 않았어요. 그 방식이 오히려 유효한 상황을 예시로 함께 다뤄보세요 (&ldquo;틀렸다&rdquo;가 아니라 &ldquo;이 카드도 있다&rdquo;).');
    else
      s.push('<b>레퍼토리 넓히기</b> — 가장 적게 쓴 방식은 ' + typeLabel(rare[0]) + '(' + usage[rare[0]] +
        '회)예요. 이 카드가 빛나는 상황을 보여주면 대응 폭이 넓어져요.');

    if (avgDistinct < 2.5)
      s.push('<b>유연성</b> — 1인 평균 ' + avgDistinct.toFixed(1) +
        '개 유형만 사용해 한 방식에 집중하는 경향이 강해요. &ldquo;상황이 바뀌면 대응도 바뀌어야 한다&rdquo;를 강조해보세요.');
    else
      s.push('<b>유연성</b> — 1인 평균 ' + avgDistinct.toFixed(1) +
        '개 유형을 오가며 상황에 따라 대응을 바꾼 편이에요. 그 전환이 상황 단서에 근거했는지 되짚는 질문이 좋아요.');

    s.push('<b>자기 이해</b> — 진단 최고 유형을 실제로 고른 결정은 ' + usageRate +
      '%예요. &ldquo;왜 진단과 다르게(혹은 같게) 움직였을까?&rdquo;를 학습자 스스로 답해보게 하면 자각이 깊어져요 (격차 자체는 좋고 나쁨이 아님).');

    // 규준 밴드 기반 제안 (TKI 공식 해석: 상위 25% = 과용 점검, 하위 25% = 과소사용 점검)
    if (A.scoreN) {
      var hiK = mostBand(A, "high"), loK = mostBand(A, "low");
      if (hiK)
        s.push('<b>많이 쓰는 방식</b> — ' + typeLabel(hiK) + '이 규준 대비 &lsquo;높음&rsquo;(상위 25%)인 학습자가 ' + A.bandByType[hiK].high + '명으로 가장 많아요. 이 방식의 강점을 인정하되, 맞지 않는 상황에서도 꺼내는 과용 신호를 함께 짚어보세요.');
      if (loK)
        s.push('<b>덜 쓰는 방식</b> — ' + typeLabel(loK) + '이 규준 대비 &lsquo;낮음&rsquo;(하위 25%)인 학습자가 ' + A.bandByType[loK].low + '명으로 가장 많아요. 이 방식이 효과적인 상황을 예시로 보여주면 오늘의 연습 포인트가 돼요.');
    }

    var oppKeys = Object.keys(A.byOpponent);
    if (oppKeys.length) {
      oppKeys.sort(function (a, b) {
        function unres(x) { var e = A.byOpponent[x].endings || {}; return ((e.patched || 0) + (e.stuck || 0)) / (A.byOpponent[x].n || 1); }
        return unres(b) - unres(a);
      });
      var top = A.byOpponent[oppKeys[0]], e = top.endings || {};
      var unresPct = pct((e.patched || 0) + (e.stuck || 0), top.n);
      if (unresPct > 0)
        s.push('<b>상황별 초점</b> — <b>' + optLabel("opponent", oppKeys[0]) +
          '</b> 상대에서 봉합·교착으로 끝난 비율이 ' + unresPct + '%로 가장 높아요. 이 관계에서의 대화 전략을 미니강의·역할극으로 다뤄보세요.');
    }

    var stages = [1, 2, 3].map(function (st) {
      var f = A.fitByStage[st]; return { st: st, poor: f.poor / (sumFit(f) || 1) };
    }).sort(function (a, b) { return b.poor - a.poor; });
    s.push('<b>단계별 초점</b> — <b>' + beatLabels[stages[0].st] +
      '</b> 단계에서 상대 심리가 굳는(마찰) 선택이 가장 잦았어요. 이 단계의 대화 기술을 보강하면 대화가 합의까지 더 잘 이어져요.');

    return s;
  }

  /* ------------------------------- 로드 ------------------------------- */
  // Apps Script 무료 웹앱은 콜드스타트·쿼터·리다이렉트로 간헐적 지연(수십 초)이나
  // 일시적 404를 낸다. 최대 3회까지 짧은 백오프로 재시도해 교수자가 보는 오류를 줄인다.
  var MAX_TRIES = 3;

  function load() {
    var token = getToken();
    var url = ENDPOINT + (token ? "?token=" + encodeURIComponent(token) : "");
    attempt(url, 1);
  }

  function attempt(url, tryNo) {
    renderEmpty("데이터를 불러오는 중…" +
      (tryNo > 1 ? " (재시도 " + tryNo + "/" + MAX_TRIES + ")" : "") +
      " — Apps Script 특성상 최초 응답까지 수십 초 걸릴 수 있습니다.");
    fetch(url, { method: "GET", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        // 서버가 배열 대신 {error:...}를 주면 권한·설정 문제다. 재시도해도 달라지지 않는다.
        if (data && !Array.isArray(data) && data.error) {
          var authErr = new Error(
            data.error === "unauthorized"
              ? "열람 권한이 없습니다 — 대시보드 주소 끝에 #token=… 이 포함됐는지 확인하세요."
              : String(data.error)
          );
          authErr.noRetry = true;
          throw authErr;
        }
        if (!Array.isArray(data)) throw new Error("형식 오류: 배열이 아님");
        render(data);
      })
      .catch(function (err) {
        if (err && err.noRetry) {
          renderEmpty(err.message);
        } else if (tryNo < MAX_TRIES) {
          setTimeout(function () { attempt(url, tryNo + 1); }, 1500 * tryNo);
        } else {
          renderEmpty("데이터를 불러오지 못했습니다(" + tryNo + "회 시도): " + err.message +
            " — 잠시 후 새로고침하거나, Apps Script 배포 URL·권한(누구나 액세스)을 확인하세요.");
        }
      });
  }

  load();
})();
