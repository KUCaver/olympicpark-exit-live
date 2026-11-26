// 공연 뒤 출차 안내. data/days.json(분석 파이프라인 결과)을 읽어 쉬운 말로 바꿔 보여 준다.
import { liveBlock, startLive } from "./live.js"; // 업그레이드(시험): 실시간 주차 대수
const FEE_PER_10MIN = 600; // 올림픽공원 주차 요금: 10분당 600원, 10분 안에 나가면 무료 (기관 주차 안내 2026-11-10 확인)
const FREE_MIN = 10;
const DAY_MAX = 20000; // 소형 하루 최대 요금 (올림픽공원 주차 안내, 2026-11-12 확인)
const SUBWAY = 1550, BUS = 1500; // 교통카드 어른 기본요금: 수도권 지하철 10km까지, 서울 간선·지선 버스 (서울교통공사·서울시, 2026-11-12 확인)
const WEEKDAYS = "월화수목금토일";
const WORD = { free: "원활", slow: "서행", jam: "정체", peak: "정체" }; // 도로 전광판 낱말
const BAR = { free: "#7b828c", slow: "#f5b800", jam: "#ff4d3d", peak: "#ff4d3d" };
const MIN_DAYS = 5; // 설계 12번: 이보다 적으면 숫자를 말하지 않는다
const GATES = ["북2문", "동2문", "남2문"]; // 문별 안내에 쓰는 세 문. 남3문·남4문·서1문·서2문도 자료에 있지만 주차장이 따로라 안내에서 뺀다

const qs = new URLSearchParams(location.search);
const app = document.getElementById("app");
const data = await fetch("data/days.json").then((r) => r.json());
const { labels: L, step_min: STEP, start_hour: START_HOUR } = data.window;
const CAP5 = data.capacity_per_min * STEP; // 관측된 최대 처리량(5분당 대수)
const days = data.days || [];
const quietDays = Array.isArray(data.quiet_days) ? data.quiet_days : null;
const types = data.types || {};
const quick = Object.fromEntries((data.quick_by_level || []).map((q) => [q.level, q]));

// 공연장 조합으로 나눈 날의 유형 (분석의 concerts.day_type과 같은 이름)
const KIND = {
  dome_plus: "KSPO DOME과 다른 큰 공연장의 공연이 겹치는 날",
  dome: "KSPO DOME 공연만 있는 날",
  hall: "KSPO DOME 말고 다른 큰 공연장 공연만 있는 날",
};
// 지난 기록 목록의 묶음 이름. 유형이 없는 몰림 날은 none으로 본다
const GROUP = [
  ["dome_plus", "KSPO DOME과 다른 큰 공연장이 겹친 날"],
  ["dome", "KSPO DOME만"],
  ["hall", "다른 큰 공연장만"],
  ["none", "큰 공연장 공연 없음"],
];
const METHOD = { baseline: "같은 유형 지난 날들의 범위", linear: "관람객 수·공연 시각으로 맞춘 직선 식" };
const today = new Date().toLocaleDateString("sv-SE"); // 보는 사람 시계의 오늘, YYYY-MM-DD
// 주소에 적힌 날은 지났어도 남긴다. 공유한 주소가 날짜가 지난 뒤에도 같은 화면을 열게 하려는 것이다
const upcoming = (data.upcoming || []).filter((u) => (u.date >= today || u.date === qs.get("on")) && KIND[u.type]);

// 주소에 날이 없고 다가오는 공연도 없을 때 처음 보일 날: 큰 공연장 공연이 있던 날 가운데 가장 몰린 날
const biggest = days.reduce((best, d, i) => {
  const score = (x) => (KIND[x.type] ? 1e6 : 0) + x.surge.peak_val;
  return score(d) > score(days[best]) ? i : best;
}, 0);
const state = {
  on: upcoming.some((u) => u.date === qs.get("on")) ? qs.get("on") : !qs.has("day") && upcoming.length ? upcoming[0].date : null, // 고른 다가오는 공연 날
  day: qs.has("day") && days[+qs.get("day")] ? +qs.get("day") : biggest,
  role: ["pickup", "plan"].includes(qs.get("role")) ? qs.get("role") : "driver",
  want: ["cheap", "calm"].includes(qs.get("want")) ? qs.get("want") : "fast", // 빨리, 싸게, 덜 막히게
  people: [1, 3, 4].includes(+qs.get("n")) ? +qs.get("n") : 2,
  view: qs.get("view") === "board" ? "board" : "card",
  bin: null, // 전광판 보기의 시연용 시각
};
let first = true;

const esc = (t) => String(t ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); // 바깥 자료는 그대로 넣지 않는다
const short = (t) => (t.length > 24 ? t.slice(0, 23) + "…" : t);
const firstShow = (x) => { // 지난 기록 목록: 첫 공연명만 줄이고 나머지는 개수로
  const c = x.concerts || [];
  return c.length ? short(String(c[0].title || "")) + (c.length > 1 ? ` 외 ${c.length - 1}개` : "") : "";
};
const shows = (x) => (x.concerts || []).map((c) => short(String(c.title || ""))).join(", ");
const num = (n) => n.toLocaleString("ko-KR");
const won = (n) => num(n) + "원";
const ceil10 = (m) => Math.ceil(m / 10) * 10;
const round5 = (m) => Math.round(m / 5) * 5;
const floor5 = (m) => Math.floor(m / 5) * 5; // 범위의 아래쪽은 내리고
const ceil5 = (m) => Math.ceil(m / 5) * 5; // 위쪽은 올려 말한다
const busyMin = (d) => (d.busy.clear - d.busy.start) * STEP;
// numpy.percentile과 같은 선형 보간
function pct(values, p) {
  const v = [...values].sort((a, b) => a - b), k = (v.length - 1) * p / 100, f = Math.floor(k);
  return f + 1 < v.length ? v[f] + (v[f + 1] - v[f]) * (k - f) : v[f];
}
// 17시부터 센 분을 "HH:MM"으로
const clock = (min) => `${String((START_HOUR + Math.floor(min / 60)) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
const spoken = (label) => {
  const [h, m] = label.split(":").map(Number);
  const part = h === 0 ? "밤" : h < 6 ? "새벽" : h < 12 ? "오전" : h === 12 ? "낮" : h < 18 ? "오후" : h < 21 ? "저녁" : "밤";
  return `${part} ${h % 12 || 12}시${m === 30 ? " 반" : m ? ` ${m}분` : ""}`;
};
const dayName = (d) => {
  const [, m, dd] = d.date.split("-").map(Number);
  return `${m}월 ${dd}일 ${WEEKDAYS[d.weekday]}요일`;
};
const year = (d) => d.date.slice(0, 4);

// 다가오는 날(u)의 시간표에 쓸 지난 날. peakTime과 같은 묶음(같은 유형·같은 평일/주말, 5일보다 적으면 같은 유형 전체)에서
// 가장 막힌 시각과 붐빈 시간이 묶음의 가운데 값에 가장 가까운 날을 고른다. 묶음이 비면 유형의 대표 날, 그것도 없으면 null
function standIn(u) {
  const same = days.filter((x) => x.type === u.type);
  let pool = same.filter((x) => (x.weekday >= 5) === (u.weekday >= 5));
  if (pool.length < MIN_DAYS) pool = same;
  if (!pool.length) {
    const t = types[u.type] || {};
    return (t.rep && days.find((x) => x.date === t.rep)) || null;
  }
  const midPeak = pct(pool.map((x) => x.surge.peak * STEP), 50), midBusy = pct(pool.map(busyMin), 50);
  const far = (x) => Math.abs(x.surge.peak * STEP - midPeak) + Math.abs(busyMin(x) - midBusy);
  return pool.reduce((a, b) => (far(b) < far(a) ? b : a));
}
// 다가오는 공연 날을 골랐으면 그날(u)과 그 시간표에 쓸 지난 날(d)을 함께 준다
function picked() {
  const u = state.on ? upcoming.find((x) => x.date === state.on) : null;
  return { u, d: u ? standIn(u) : days[state.day] };
}

// 다가오는 날: 같은 유형·같은 요일 묶음(평일/주말)의 지난 몰림 날에서 가장 막힌 시각의 10~90%
function peakTime(u) {
  const weekend = (x) => x.weekday >= 5;
  const same = days.filter((x) => x.type === u.type);
  let pool = same.filter((x) => weekend(x) === weekend(u)), scope = weekend(u) ? "주말" : "평일";
  if (pool.length < MIN_DAYS) { pool = same; scope = null; }
  if (pool.length < MIN_DAYS) return { n: pool.length, scope, line: "이런 날의 기록이 적어 언제 가장 막힐지는 말하기 어려워요." };
  const ms = pool.map((x) => x.surge.peak * STEP);
  const lo = Math.round(pct(ms, 10) / 10) * 10, hi = Math.round(pct(ms, 90) / 10) * 10;
  const who = scope ? `${scope}의 이런 공연 날 가운데 나가는 차가 몰린 날은` : "이런 공연 날 가운데 나가는 차가 몰린 날은"; // 몰린 날만 센다
  const line = lo === hi
    ? `${who} 보통 ${spoken(clock(lo))} 무렵 가장 막혔어요.`
    : `${who} 보통 ${spoken(clock(lo))}~${spoken(clock(hi)).replace(spoken(clock(lo)).split(" ")[0] + " ", "")} 사이에 가장 막혔어요.`; // 밤 8시~11시 반
  return { n: pool.length, scope, line };
}
// 다가오는 날: 유형의 붐빈 시간 범위(10~90%). 몰림이 없던 공연 날은 0분으로 들어 있다
// 말할 갈래는 반올림 전 값으로 고르고, 말하는 숫자는 아래쪽(10%)은 5분 단위로 내리고 위쪽(90%)은 올린다
const busyNums = (t) => (t && t.enough && Array.isArray(t.range_busy_min) && t.range_busy_min.length === 3 ? t.range_busy_min : null);
function busyRange(t) {
  const r = busyNums(t);
  if (!r) return "이런 조합의 날은 기록이 적어요.";
  const [lo, mid, hi] = r, lo5 = floor5(lo), hi5 = ceil5(hi);
  // 몰리지 않은 공연 날까지 센 값이라 "이런 공연 날 전체로 보면"이라고 밝힌다
  if (hi <= 0) return "이런 공연 날 전체로 보면 나가는 길이 거의 붐비지 않았어요.";
  if (lo > 0) {
    if (lo5 <= 0) return `이런 공연 날 전체로 보면 열에 아홉은 붐빈 시간이 ${hi5}분 안이었어요.`;
    return lo5 === hi5 ? `이런 공연 날 전체로 보면 나가는 길이 보통 ${hi5}분쯤 붐볐어요.` : `이런 공연 날 전체로 보면 나가는 길이 보통 ${lo5}~${hi5}분 붐볐어요.`;
  }
  return mid <= 0
    ? `이런 공연 날 전체로 보면 절반 넘는 날은 나가는 길이 붐비지 않았어요. 몰리지 않은 날까지 합쳐 열에 아홉은 붐빈 시간이 ${hi5}분 안이었어요.`
    : `이런 공연 날 전체로 보면 나가는 길이 붐비지 않은 날도 있었어요. 몰리지 않은 날까지 합쳐 열에 아홉은 붐빈 시간이 ${hi5}분 안이었어요.`;
}
// 큰 공연장 공연이 있던 몰림 날 가운데 세 문이 모두 붐볐던 날에서, 보통 가장 먼저 풀린 문(base)과 같은 날끼리 짝지은 차이의 가운데 값.
// 표지판 문장과 근거 보기가 같은 값(paired)을 쓴다
const gateStat = (() => {
  const ok = (x) => x.gates && GATES.every((g) => x.gates[g] && x.gates[g].busy && x.gates[g].clear != null);
  const rows = days.filter((x) => KIND[x.type] && ok(x));
  if (rows.length < 10) return { n: rows.length, line: "" };
  const med = GATES.map((g) => pct(rows.map((x) => (x.gates[g].clear - Math.min(...GATES.map((h) => x.gates[h].clear))) * STEP), 50));
  const lo = med.indexOf(Math.min(...med));
  // 같은 날끼리 짝지어 (다른 문 - 가장 먼저 풀린 문)의 가운데 값을 낸다. 가운데 값끼리 빼지 않는다
  const paired = GATES.map((g) => pct(rows.map((x) => (x.gates[g].clear - x.gates[GATES[lo]].clear) * STEP), 50));
  const hi = paired.indexOf(Math.max(...paired)), gap = paired[hi];
  return { n: rows.length, base: GATES[lo], paired, line: gap >= 10 ? `세 문이 모두 붐빈 공연 날에는 ${GATES[lo]}이 보통 가장 먼저 풀렸어요(${GATES[hi]}보다 ${round5(gap)}분쯤 먼저).` : "" };
})();

// 출구가 얼마나 붐비는지: 그 구간과 다음 구간의 출차를 처리량에 견준다 (분석의 quick.by_flow_level과 같은 기준)
function level(d, bin) {
  const share = ((d.out[bin] || 0) + (d.out[bin + 1] || 0)) / 2 / CAP5;
  return share >= data.levels.peak ? "peak" : share >= data.levels.jam ? "jam" : share >= data.levels.slow ? "slow" : "free";
}
// 세 선택: 가장 막힐 때, 중간, 붐빔이 끝난 뒤. 주차비가 딱 떨어지게 10분 단위로 잡는다.
function offsets(d) {
  const last = Math.max(20, ceil10((d.busy.clear - d.surge.peak) * STEP));
  return [0, Math.max(10, Math.round(last / 20) * 10), last];
}
const minutesOut = (lv) => (quick[lv] && quick[lv].stay_median !== null ? Math.round(quick[lv].stay_median) : null);
const gonePhrase = (d, off) => {
  const i = Math.min(d.busy.cum.length - 1, Math.max(0, d.surge.peak - d.busy.start + off / STEP));
  const g = Math.round(d.busy.cum[i] / 10);
  if (g <= 0) return "붐비는 시간에 나갈 차가 아직 거의 다 남아 있을 때예요.";
  if (g >= 10) return "붐비는 시간에 나갈 차가 다 빠져나간 뒤예요.";
  return `붐비는 시간에 나간 차 10대 중 ${g}대가 빠져나간 뒤예요.`;
};

const REC = `<span class="rec">추천</span>`;
const FEW = { answer: "이런 날의 기록이 적어 언제 나가면 좋을지 말하기 어려워요.", stops: [] };

function driverView(d, that) {
  if (!d) return FEW;
  const offs = offsets(d), last = offs[2];
  const atPeak = minutesOut(level(d, d.surge.peak)), after = minutesOut("free");
  const mild = atPeak !== null && after !== null && atPeak - after <= 2;
  // 줄은 먼저 선 차부터 빠지니 빨리·싸게는 바로 출발이다. 덜 막히게는 덜 붐빈 길을 원하는 선택이라 한산해질 때까지 기다린다
  // (붐빔이 가벼운 날(mild)에도 덜 막히게는 기다리라고 하되, 아끼는 시간이 크지 않다고 함께 말한다)
  const pick = state.want !== "calm" ? 0 : 2;
  const answer = mild
    ? state.want === "calm"
      ? `덜 막히게 가려면 ${last}분 기다리세요. 주차비는 <span class="money">${won((last / 10) * FEE_PER_10MIN)} 더</span> 들어요. 다만 ${that} 가장 붐빌 때도 잠깐 들른 차가 ${atPeak}분이면 나와, 기다려서 아끼는 시간은 크지 않았어요.`
      : `${that} 가장 붐빌 때도 잠깐 들른 차가 ${atPeak}분이면 나왔어요. 바로 나서도 괜찮았어요.`
    : state.want === "fast"
      ? `빨리 가려면 바로 나서세요. 줄은 먼저 선 차부터 빠져요. 대신 가장 막힐 때라 줄에서 기다려야 해요.`
      : state.want === "cheap"
        ? `싸게 가려면 바로 나서세요. 기다리면 주차비가 <span class="money">10분마다 ${won(FEE_PER_10MIN)}</span>씩 붙어요.`
        : `덜 막히게 가려면 ${last}분 기다리세요. 그때는 한산해졌어요. 주차비는 <span class="money">${won((last / 10) * FEE_PER_10MIN)} 더</span> 들어요.`;
  const stops = offs.map((off, i) => {
    const lv = level(d, d.surge.peak + off / STEP), m = minutesOut(lv);
    return `<li class="stop">
      <h2>${off === 0 ? "가장 막힐 때 출발" : `${off}분 더 있다 출발`}<span class="vms ${lv}">${WORD[lv]}</span>${i === pick ? REC : ""}</h2>
      <p class="big ${off ? "costly" : ""}">${off ? `주차비 ${won((off / 10) * FEE_PER_10MIN)} 더` : "주차비 그대로"}</p>
      ${m !== null ? `<p>이만큼 붐빌 때 잠깐 들른 차는 나오는 데 ${m}분쯤 걸렸어요.</p>` : ""}
      <p class="note">${gonePhrase(d, off)}</p>
    </li>`;
  });
  return { answer, stops };
}

function pickupView(d, that) {
  if (!d) return FEW;
  const offs = offsets(d), last = offs[2];
  const lvs = offs.map((off) => level(d, d.surge.peak + off / STEP)), ms = lvs.map(minutesOut);
  const atPeak = ms[0], after = minutesOut("free");
  const known = atPeak !== null && after !== null, mild = known && atPeak <= FREE_MIN;
  const freeAt = ms.findIndex((m) => m !== null && m <= FREE_MIN); // 주차비 없이 나올 수 있는 가장 이른 선택
  // 붐빔이 가벼운 날(mild)에도 덜 막히게는 늦게 가는 쪽을 고른다. 빨리·싸게는 바로 가도 주차비가 없는 편이라 맨 앞이다
  const pick = !known ? -1 : state.want === "fast" ? 0 : state.want === "cheap" && freeAt >= 0 ? freeAt : 2;
  const answer = !known
    ? "이만큼 붐빈 날의 기록이 아직 적어요."
    : mild
      ? state.want === "calm"
        ? `덜 막히게 하려면 ${last}분 늦게 가세요. 다만 ${that} 가장 붐빌 때 들어가도 ${atPeak}분쯤이면 나와 ${FREE_MIN}분 안이라 주차비가 없는 편이었어요.`
        : `${that} 가장 붐빌 때 들어가도 ${atPeak}분쯤이면 나왔어요. ${FREE_MIN}분 안이라 주차비가 없는 편이에요.`
      : state.want === "fast"
        ? `일행을 빨리 태우려면 가장 막힐 때라도 맞춰 가세요. 들어갔다 나오는 데 ${atPeak}분쯤 걸렸고, ${FREE_MIN}분을 넘겨 주차비가 붙기 쉬워요.`
        : state.want === "cheap" && freeAt >= 0
          ? `싸게 하려면 ${offs[pick]}분 늦게 가세요. ${ms[pick]}분쯤이면 나와 <span class="money">주차비 없이</span> 나올 수 있었어요.`
          : `덜 막히게 하려면 ${last}분 늦게 가세요. 그때는 들어갔다 나오는 데 ${ms[2] ?? after}분쯤이었어요.`;
  const stops = offs.map((off, i) => {
    const m = ms[i];
    return `<li class="stop">
      <h2>${off === 0 ? "가장 막힐 때 도착" : `${off}분 늦게 도착`}<span class="vms ${lvs[i]}">${WORD[lvs[i]]}</span>${i === pick ? REC : ""}</h2>
      ${m === null
        ? `<p class="big">기록이 적어 알 수 없어요</p>`
        : `<p class="big ${m > FREE_MIN ? "costly" : ""}">들어갔다 나오는 데 ${m}분쯤</p>
           <p>${m > FREE_MIN ? `${FREE_MIN}분을 넘겨 주차비가 붙기 쉬워요.` : `${FREE_MIN}분 안에 나와 주차비가 없는 편이에요.`}</p>`}
    </li>`;
  });
  return { answer, stops, extra: `<p class="note">${FREE_MIN}분 안에 나가면 무료, 넘기면 10분마다 ${won(FEE_PER_10MIN)}이에요.</p>` };
}

// 집을 나서기 전: 차로 갈지 지하철·버스로 갈지를 돈으로 견준다. 걸리는 시간은 출발지마다 달라 견주지 않는다.
function planView(d, that, u) {
  const n = state.people, stay = d && d.parked ? d.parked.stay_median : null;
  const people = `<div class="roles four" role="group" aria-label="몇 명이 가는지 고르기">${[1, 2, 3, 4].map((k) => `<button type="button" data-people="${k}" aria-pressed="${k === n}">${k}명</button>`).join("")}</div>`;
  const before = `<p class="ask">몇 명이 가요?</p>${people}`;
  if (stay === null || stay === undefined) return { answer: "이런 날 차를 세워 둔 시간의 기록이 아직 적어요.", stops: [], quiet: true, before };
  const car = Math.min(DAY_MAX, Math.ceil(stay / 10) * FEE_PER_10MIN), sub = SUBWAY * 2 * n, bus = BUS * 2 * n;
  const half = Math.round(stay / 30) / 2, hours = Number.isInteger(half) ? `${half}시간` : `${Math.floor(half)}시간 반`;
  const answer = `${n}명이 가면 지하철 왕복은 <span class="money">약 ${won(sub)}</span>, 차는 주차비만 <span class="money">약 ${won(car)}</span>이에요.${sub < car ? ` 지하철이 ${won(car - sub)}쯤 싸요. 버스도 비슷해요.` : sub > car ? ` 차가 ${won(sub - car)}쯤 싸요.` : ""}`;
  // 지하철과 버스는 몇백 원 차이라 순위를 매기지 않고 차와만 견준다
  const cheaper = (v) => (v < car ? `<span class="rec">차보다 싸요</span>` : "");
  const stops = [
    `<li class="stop"><h2>지하철${cheaper(sub)}</h2>
      <p class="big">왕복 약 ${won(sub)}</p>
      <p>KSPO DOME에서 가장 가까운 역은 5·9호선 올림픽공원역이에요.</p>
      <p class="note">한 사람 ${won(SUBWAY)}(10km까지) 기준이에요. 멀면 5km마다 100원씩 더 붙어요. 공연 뒤 역이 얼마나 붐비는지는 자료가 없어요.</p></li>`,
    `<li class="stop"><h2>버스${cheaper(bus)}</h2>
      <p class="big">왕복 약 ${won(bus)}</p>
      <p class="note">서울 간선·지선 버스 한 사람 ${won(BUS)} 기준이에요. 노선과 걸리는 시간은 지도 앱에서 확인하세요.</p></li>`,
    `<li class="stop"><h2>차${car < Math.min(sub, bus) ? `<span class="rec">가장 싸요</span>` : ""}</h2>
      <p class="big costly">주차비 약 ${won(car)}</p>
      <p>붐빌 때 나간 차는 보통 ${hours}쯤 세워 뒀어요. 10분마다 ${won(FEE_PER_10MIN)}, 하루 최대 ${won(DAY_MAX)}이에요.</p>
      <p class="note">기름값과 통행료는 뺀 값이에요. 나가는 길은 ${busyMin(d)}분쯤 붐볐어요. 올림픽공원도 큰 행사 날에는 대중교통을 권해요.</p></li>`,
  ];
  const basis = u ? `<p class="note">나가는 길이 붐빈 시간, 세워 둔 시간, 주차비는 비슷했던 하루(${year(d)}년 ${dayName(d)}) 기준이에요.</p>` : "";
  return { answer, stops, quiet: true, before,
    extra: `${basis}<p class="note">걸리는 시간은 출발지마다 달라 여기서는 견주지 않아요. <a href="https://map.kakao.com/link/search/올림픽공원" rel="noopener">카카오맵에서 가는 길 보기</a></p>` };
}

function chart(d) {
  const from = (18 - START_HOUR) * 60 / STEP, to = (25 - START_HOUR) * 60 / STEP; // 18:00~01:00
  const W = 420, H = 190, P = { l: 30, r: 6, t: 10, b: 24 };
  const bw = (W - P.l - P.r) / (to - from);
  const max = Math.max(1, ...d.out.slice(from, to)) * 1.08;
  const x = (i) => P.l + (i - from) * bw, y = (v) => H - P.b - (v / max) * (H - P.t - P.b);
  let g = "";
  for (let v = 0; v <= max; v += 50) {
    g += `<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="#3a4049"/><text x="${P.l - 5}" y="${y(v) + 4}" font-size="10" fill="#a9adb3" text-anchor="end">${v}</text>`;
  }
  for (let i = from; i < to; i++) {
    g += `<rect x="${(x(i) + 0.6).toFixed(1)}" y="${y(d.out[i]).toFixed(1)}" width="${(bw - 1.2).toFixed(1)}" height="${(H - P.b - y(d.out[i])).toFixed(1)}" fill="${BAR[level(d, i)]}"/>`;
  }
  g += `<polyline fill="none" stroke="#f3f2ec" stroke-width="1.5" stroke-dasharray="4 3" points="${d.base_out.slice(from, to).map((v, k) => `${(x(from + k) + bw / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}"/>`;
  for (let i = from; i < to; i += 60 / STEP) g += `<text x="${x(i)}" y="${H - 7}" font-size="10" fill="#a9adb3">${L[i]}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${dayName(d)} 저녁 5분마다 나간 차 수. ${L[d.busy.start]}부터 ${L[d.busy.clear]}까지 붐볐다.">${g}</svg>`;
}

// 연계 자료의 공연 시간대에 견준 가장 막힌 때. 연계 자료의 시간대는 실제 끝난 시각이 아니라서 "공연이 끝나고"라고 하지 않는다
function linkedLine(d) {
  if (d.first_hour == null || d.last_hour == null) return "";
  const last = d.last_hour < 2 ? d.last_hour + 24 : d.last_hour;
  const lag = d.surge.peak * STEP - (last + 1 - START_HOUR) * 60;
  const hour = (h) => spoken(`${String(h % 24).padStart(2, "0")}:00`);
  // 마지막 시간대는 last시~(last+1)시 한 시간이다. lag는 그 시간대가 끝나는 (last+1)시 기준
  const where = lag >= 0 ? `그 마지막 시간대가 끝나는 ${hour(last + 1)}보다 ${lag}분 뒤였어요`
    : lag + 60 >= 0 ? "그 마지막 시간대 안이었어요"
      : `그 마지막 시간대가 시작하는 ${hour(last)}보다 ${-(lag + 60)}분 앞이었어요`;
  return `<p class="fine">연계 자료가 공연을 ${hour(d.first_hour)}대부터 ${hour(last)}대(${hour(last)}~${hour(last + 1).replace(hour(last).split(" ")[0] + " ", "")})까지 표시한 날이에요. 가장 막힌 때(${spoken(L[d.surge.peak])})는 ${where}. 연계 자료의 시간대는 실제 공연이 끝난 시각과 다를 수 있어요.</p>`;
}

// 표본 수와 검증 결과. 화면 안내는 같은 유형 지난 날들의 범위(baseline)로 만들므로 그 방법의 숫자를 보인다.
// 선형 식은 비교용으로만 맞혀 봤다(2025 전체 자료에서 같은 날 기준 오차 차이 약 1분)
const SHOWN = "baseline";
function sampleBlock() {
  const cars = days.reduce((s, x) => s + (x.busy.cars || 0), 0);
  const v = data.validation && { ...data.validation, adopted: SHOWN };
  const m = v && v[v.adopted] && v[v.adopted].busy_min;
  const hit = (x, name) => (x && Number.isFinite(x.coverage)
    ? `<dt>${name}</dt><dd>${Math.round(x.coverage * 100)}%${Number.isFinite(x.n) ? ` (${num(x.n)}일)` : ""}</dd>` : "");
  const hot = m && v[v.adopted].busy_min_surge_only, peakHit = v && v.clock && v.clock.peak_clock;
  const check = m && Number.isFinite(m.mae)
    ? `<dt>맞혀 본 방법</dt><dd>${METHOD[v.adopted] || esc(v.adopted)}</dd>
      <dt>붐빈 시간 평균 오차</dt><dd>${Math.round(m.mae)}분${Number.isFinite(m.n) ? ` (${num(m.n)}일)` : ""}</dd>
      ${hit(m, "붐빈 시간이 10~90% 범위에 든 날 (몰리지 않은 공연 날 포함)")}
      ${hit(hot, "붐빈 시간이 10~90% 범위에 든 날 (몰린 날만)")}
      ${hit(peakHit, "가장 막힌 시각 범위가 맞은 날")}`
    : `<dt>맞혀 본 결과</dt><dd>아직 없음</dd>`;
  const gate = gateStat.n >= 10
    ? `${gateStat.n}일 (${gateStat.base}보다 ${GATES.filter((g) => g !== gateStat.base).map((g) => `${g} ${round5(gateStat.paired[GATES.indexOf(g)])}분`).join(", ")} 늦게 풀림)`
    : `${gateStat.n}일 (적어서 문별 안내는 하지 않아요)`;
  return `<dl>
      <dt>2025년 나가는 차가 몰린 날</dt><dd>${days.length}일</dd>
      ${quietDays ? `<dt>큰 공연이 있었지만 몰리지 않은 날</dt><dd>${quietDays.filter((q) => KIND[q.type]).length}일</dd>` : ""}
      <dt>붐빈 시간에 나간 차 (몰린 날 모두 더함)</dt><dd>${num(cars)}대</dd>
      ${check}
      <dt>큰 공연 날 가운데 북2문·동2문·남2문이 모두 붐빈 날</dt><dd>${gate}</dd>
    </dl>
    <p class="fine">맞혀 본 방법은 하루씩 빼고 나머지 날로 그날의 붐빈 시간을 맞혀 본 결과예요. "몰리지 않은 공연 날 포함"은 그런 날을 0분으로 넣고 맞힌 값이라 "몰린 날만"보다 높게 나오기 쉬워요. 가장 막힌 시각은 같은 유형·같은 요일 묶음(5일보다 적으면 같은 유형 전체)의 다른 몰린 날로 범위를 잡아 맞혀 봤어요. 문별 분은 보통 가장 먼저 풀린 문과 같은 날끼리 짝지어, 그 문보다 늦게 풀린 분의 가운데 값이에요(예: 남2문이 기준이면 "남2문보다 늦게 풀린 분"). 가장 막힌 시각을 맞힌 비율은 10분 단위로 반올림하기 전 범위로 셌어요. 문별 분은 큰 공연장 공연이 있던 몰린 날만 셌어요.</p>`;
}

function upcomingBlock(u) {
  const t = types[u.type] || {}, r = busyNums(t), p = peakTime(u);
  return `<dl>
      <dt>이 유형의 2025년 공연 날</dt><dd>${t.n_days != null ? `${t.n_days}일` : "기록 없음"}</dd>
      <dt>붐빈 시간 (10%·가운데·90%)</dt><dd>${r ? [floor5(r[0]), round5(r[1]), ceil5(r[2])].map((x) => `${x}분`).join(" · ") : "기록 적음"}</dd>
      <dt>가장 막힌 때를 센 날</dt><dd>${p.n}일${p.scope ? ` (${p.scope})` : p.n >= MIN_DAYS ? " (평일·주말 합침)" : ""}</dd>
    </dl>
    <p class="fine">붐빈 시간 범위에는 몰리지 않은 공연 날이 0분으로 들어 있어요. 10%는 5분 단위로 내리고 90%는 5분 단위로 올렸어요.${p.n >= MIN_DAYS ? ` 가장 막힌 때는 같은 유형의 몰린 날${p.scope ? " 가운데 같은 요일 묶음(평일 또는 주말)" : ""}에서 가운데 80%의 날이 든 범위를 10분 단위로 반올림했어요.` : ""}</p>`;
}

function proof(d, u) {
  const row = (lv, name) => {
    const q = quick[lv];
    if (!q) return "";
    return `<dt>${name}</dt><dd>${q.stay_median === null ? "기록 적음" : `${Math.round(q.stay_median)}분`} (${num(q.n)}대, ${q.days}일)</dd>`;
  };
  const usual = d && (d.base_days > 0
    ? `공연 없는 ${WEEKDAYS[d.weekday]}요일 ${d.base_days}일의 가운데 값`
    : `공연 없는 ${WEEKDAYS[d.weekday]}요일이 없어, 가장 한산했던 값`);
  const dayPart = d ? `${chart(d)}
    <div class="legend"><span><i style="background:${BAR.jam}"></i>정체</span><span><i style="background:${BAR.slow}"></i>서행</span><span><i style="background:${BAR.free}"></i>원활</span><span><i style="background:#f3f2ec"></i>평소</span></div>
    <dl>
      <dt>${u ? "시간표에 쓴 날" : "기록한 날"}</dt><dd>${year(d)}년 ${dayName(d)}</dd>
      ${d.concerts && d.concerts.length ? `<dt>그날 공연</dt><dd>${d.concerts.map((c) => `${esc(short(String(c.title || "")))} (${esc(c.venue)})`).join("<br>")}</dd>` : ""}
      ${d.audience != null ? `<dt>연계 자료의 관람객 수</dt><dd>${esc(Number.isFinite(d.audience) ? num(d.audience) : d.audience)}명</dd>` : ""}
      <dt>붐빈 시간</dt><dd>${L[d.busy.start]}~${L[d.busy.clear]} (${busyMin(d)}분)</dd>
      <dt>그 시간에 나간 차</dt><dd>${num(d.busy.cars)}대</dd>
      <dt>가장 붐빈 5분</dt><dd>${L[d.surge.peak]}, ${d.surge.peak_val}대</dd>
      <dt>붐빌 때 나간 차가 세워 둔 시간</dt><dd>${!d.parked || d.parked.stay_median === null ? "기록 적음" : `가운데 값 ${Math.round(d.parked.stay_median)}분 (${num(d.parked.n)}대)`}</dd>
      <dt>출구가 가장 많이 내보낸 때</dt><dd>1분에 약 ${Math.round(data.capacity_per_min)}대</dd>
    </dl>
    ${u ? "" : linkedLine(d)}
    <p class="fine">정체는 출구가 가장 많이 내보낸 때의 70% 이상, 서행은 40% 이상으로 나가던 때예요. 평소 선은 ${usual}이에요.</p>`
    : `<p class="fine">이 유형의 몰린 날 기록이 없어 그래프를 그리지 않았어요.</p>`;
  const peakNote = quick.peak ? ` 가장 붐빌 때의 기록은 ${quick.peak.days}일 치 ${num(quick.peak.n)}대뿐이라 달라질 수 있어요.` : "";
  return `<details class="proof">
    <summary>근거 보기</summary>
    ${dayPart}
    ${u ? upcomingBlock(u) : ""}
    ${sampleBlock()}
    <dl>
      <dt>잠깐 들른 차가 나오는 데 걸린 시간</dt><dd></dd>
      ${row("peak", "가장 붐빌 때 (85% 이상)")}${row("jam", "정체 (70~85%)")}${row("slow", "서행")}${row("free", "원활")}
    </dl>
    <p class="fine">한국체육산업개발 올림픽공원 2025 입출차정보(문화공공데이터광장 API_CPM_008)로 계산했어요. 공연명과 공연장은 공연정보(통합)(API_CCA_144)에서, 관람객 수와 공연이 표시된 시간대는 올림픽공원 2025 차량입출차·공연·날씨정보 등 연계 데이터(API_CPM_009)에서 가져왔어요. 연계 데이터의 날씨·차량 대수 칸은 비어 있어요. 공연정보(통합)의 공연 기간 안의 모든 날에 공연이 있다고 봤어요. 지난 기록이라 오늘은 다를 수 있어요. 주차장의 모든 문을 합친 값이에요. "잠깐 들른 차"는 한 시간 안에 나간 차 전부라서, 데리러 온 차만 고른 값은 아니에요.${peakNote} 주차비는 10분당 ${won(FEE_PER_10MIN)}, 하루 최대 ${won(DAY_MAX)}으로 셈했어요(올림픽공원 주차 안내). 지하철 ${won(SUBWAY)}과 버스 ${won(BUS)}은 교통카드 어른 기본요금이에요(서울교통공사, 서울시). 요금은 2026년 11월 12일에 확인했어요. "빨리" 추천은 기록이 아니라 먼저 줄 선 차가 먼저 나간다는 셈이에요. 관람객 차가 주차 칸에서 출구까지 걸린 시간은 이 자료로 알 수 없어요.</p>
  </details>`;
}

// 지난 기록 목록: 유형별로 묶고 최근 날부터
function pastOptions(u) {
  return GROUP.map(([key, name]) => {
    const items = days.map((x, i) => [x, i]).filter(([x]) => (KIND[x.type] ? x.type : "none") === key)
      .sort((a, b) => (a[0].date < b[0].date ? 1 : -1));
    if (!items.length) return "";
    const opts = items.map(([x, i]) => `<option value="day:${i}" ${!u && i === state.day ? "selected" : ""}>${dayName(x)} · ${esc(firstShow(x)) || `가장 붐빈 5분에 ${x.surge.peak_val}대`}</option>`).join("");
    return `<optgroup label="${name}">${opts}</optgroup>`;
  }).join("");
}

function card(d, u) {
  const v = { driver: driverView, pickup: pickupView, plan: planView }[state.role](d, u ? "비슷했던 날은" : "이날은", u);
  const wants = v.quiet ? "" : `<p class="ask">무엇이 더 중요해요?</p>
    <div class="roles three" role="group" aria-label="무엇이 더 중요한지 고르기">${[["fast", "빨리"], ["cheap", "싸게"], ["calm", "덜 막히게"]].map(([k, name]) => `<button type="button" data-want="${k}" aria-pressed="${state.want === k}">${name}</button>`).join("")}</div>`;
  const next = upcoming.map((x) => `<option value="on:${x.date}" ${u === x ? "selected" : ""}>${dayName(x)}${x.date < today ? " (지난 날)" : ""} · ${esc(shows(x))}</option>`).join("");
  const event = u ? `<div class="event">
      <p class="event-day">${dayName(u)}</p>
      <ul>${(u.concerts || []).map((c) => `<li>${/^https?:\/\//.test(String(c.url || "")) ? `<a href="${esc(c.url)}" rel="noopener">${esc(c.title)}</a>` : esc(c.title)} <span>${esc(c.venue)}</span></li>`).join("")}</ul>
      <p class="kind">${KIND[u.type]}이에요. ${busyRange(types[u.type])}</p>
    </div>` : "";
  const gate = gateStat.line ? ` ${gateStat.line}` : "";
  const when = !d
    ? (u ? peakTime(u).line : "")
    : u
      ? `${peakTime(u).line} 아래 시간표는 이런 날 가운데 ${year(d)}년 ${dayName(d)} 기록이에요.${gate}`
      : `${dayName(d)}에는 ${spoken(L[d.busy.start])}부터 ${spoken(L[d.busy.clear])}까지 붐볐고, ${spoken(L[d.surge.peak])} 무렵이 가장 막혔어요.${gate}`;
  return `<h1 class="road-title"><span>나갈깍?</span></h1>
    <p class="lede">올림픽공원 주차장에서 공연이 끝난 뒤 나가는 길을 지난 기록으로 알려 드려요.</p>
    <div class="roles" role="group" aria-label="누구인지 고르기">
      <button type="button" data-role="driver" aria-pressed="${state.role === "driver"}">차를 가져왔어요</button>
      <button type="button" data-role="pickup" aria-pressed="${state.role === "pickup"}">데리러 가요</button>
      <button type="button" class="wide" data-role="plan" aria-pressed="${state.role === "plan"}">차로 갈지 지하철로 갈지 고민돼요</button>
    </div>
    <label class="pick"><span>공연 날 고르기</span><select id="day">
      ${next ? `<optgroup label="다가오는 공연">${next}</optgroup>` : ""}
      ${pastOptions(u)}
    </select></label>
    ${event}
    <div id="live">${liveBlock(u, today)}</div>
    ${wants}${v.before || ""}
    <p class="answer">${v.answer}</p>
    <p class="when" ${v.quiet ? "hidden" : ""}>${when}</p>
    ${v.extra || ""}
    ${v.stops.length ? `<ol class="lane">${v.stops.join("")}</ol>` : ""}
    ${proof(d, u)}`;
}

function board(d) {
  if (!d) return `<div class="board-plate">
      <div class="board-head"><span>올림픽공원 주차장 나가는 길</span></div>
      <p class="board-line">이런 날의 기록이 적어 시연할 수 없어요.</p>
    </div>`;
  const lo = Math.max(0, d.busy.start - 6), hi = Math.min(d.out.length - 2, d.busy.clear + 6);
  if (state.bin === null) state.bin = d.surge.peak;
  const lv = level(d, state.bin);
  const left = (d.busy.clear - state.bin) * STEP;
  const line = state.bin < d.busy.start
    ? `곧 나가는 차가 몰려요. 지난 비슷한 날은 ${spoken(L[d.busy.start])}부터였어요.`
    : left > 0
      ? `약 ${left}분 뒤 한산해져요. 기다리면 주차비 <span class="money">${won((ceil10(left) / 10) * FEE_PER_10MIN)} 더</span>.`
      : "지금 나가도 좋아요.";
  return `<div class="board-plate">
      <div class="board-head"><span>올림픽공원 주차장 나가는 길</span><span>${L[state.bin]}</span></div>
      <div class="board-word ${lv}">${WORD[lv]}</div>
      <p class="board-line">${line}</p>
    </div>
    <label class="board-ctl">시연용 시각 <input id="scrub" type="range" min="${lo}" max="${hi}" value="${state.bin}"></label>
    <p class="fine">${year(d)}년 ${dayName(d)} 기록을 그 시각의 화면처럼 보여 주는 시연이에요. 실시간 값이 아니에요.</p>`;
}

function render() {
  const { d, u } = picked();
  document.body.className = [state.view === "board" ? "board" : "", first ? "first" : ""].join(" ").trim();
  app.innerHTML = state.view === "board" ? board(d) : card(d, u);
  history.replaceState(null, "", `?${state.on ? `on=${state.on}` : `day=${state.day}`}&role=${state.role}${state.role === "plan" ? `&n=${state.people}` : `&want=${state.want}`}${state.view === "board" ? "&view=board" : ""}`);
}

app.addEventListener("click", (e) => {
  if (e.target.closest("[data-live]")) { startLive(showLive); return; }
  const b = e.target.closest("[data-role],[data-want],[data-people]");
  if (!b) return;
  const key = Object.keys(b.dataset)[0];
  state[key] = key === "people" ? +b.dataset.people : b.dataset[key];
  first = false; render();
  const again = app.querySelector(`[data-${key}="${state[key]}"]`);
  if (again) again.focus();
});
app.addEventListener("change", (e) => {
  if (e.target.id !== "day") return;
  const [kind, value] = e.target.value.split(":");
  if (kind === "on") state.on = value; else { state.on = null; state.day = +value; }
  state.bin = null; first = false; render();
  document.getElementById("day").focus();
});
app.addEventListener("input", (e) => {
  if (e.target.id !== "scrub") return;
  state.bin = +e.target.value; first = false; render();
  document.getElementById("scrub").focus();
});
render();
// 실시간 값이 오면 그 칸만 다시 그린다(펼쳐 둔 근거 보기가 닫히지 않게)
function showLive() { const el = document.getElementById("live"); if (el) el.innerHTML = liveBlock(picked().u, today); }
startLive(showLive);
