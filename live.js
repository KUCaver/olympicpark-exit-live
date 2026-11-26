// 업그레이드(시험): 한국체육산업개발 실시간 주차현황(공공데이터포털 15168686)의 공원 전체 주차 대수로
// 오늘 붐빌 시간을 다시 어림한다. 식은 작업/업그레이드_실시간_20261124/fit_live.py가 만든 data/live_model.json.
// 요청 주소(공용 키 포함)는 코드에 적지 않고, 기관 누리집의 안내 페이지에서 그때그때 읽는다.
const PAGE = "https://www.ksponco.or.kr/pubData/64?mid=a10106020000";
const qs = new URLSearchParams(location.search);
const model = await fetch("data/live_model.json").then((r) => r.json()).catch(() => null);
// 시연: ?now=19:00&cars=2600 처럼 시각과 대수를 정해 볼 수 있다(화면에 시연값이라고 밝힌다)
const demoNow = /^\d{1,2}:\d{2}$/.test(qs.get("now") || "") ? qs.get("now") : null;
const demoCars = Number.isFinite(+qs.get("cars")) && qs.get("cars") ? +qs.get("cars") : null;
const live = { n: demoCars, at: null, err: false, busy: false };
let url = null;

export async function startLive(onUpdate) {
  if (demoCars !== null || live.busy) return;
  live.busy = true;
  try {
    if (!url) {
      const m = (await fetch(PAGE).then((r) => r.text())).match(/https?:\/\/www\.ksponco\.or\.kr\/online\/main\/parkingorsApi\.do\?[^\s"'<>]+/);
      if (!m) throw new Error("요청 주소 없음");
      url = m[0].replaceAll("&amp;", "&");
    }
    const n = Number((await fetch(url).then((r) => r.json()))?.[0]?.parking_sum);
    if (!Number.isFinite(n) || n < 0) throw new Error("값 없음");
    Object.assign(live, { n, at: new Date(), err: false });
  } catch {
    live.err = true; // 오류 문구에 요청 주소(키)가 섞일 수 있어 화면·콘솔에 남기지 않는다
  }
  live.busy = false;
  onUpdate();
}

const hm = (d) => d.toTimeString().slice(0, 5);
const nowMin = () => (demoNow ? demoNow.split(":").reduce((h, m) => h * 60 + +m) : new Date().getHours() * 60 + new Date().getMinutes());
const floor5 = (m) => Math.floor(m / 5) * 5, ceil5 = (m) => Math.ceil(m / 5) * 5, round5 = (m) => Math.round(m / 5) * 5;

// 그 시각(17~21시)의 식으로 붐빌 분과 10~90% 범위. 식이 없는 시각이면 null
export function guess(type, weekend, minute, cars) {
  const h = model && model.hours[String(Math.floor(minute / 60))];
  if (!h || !model.kinds.includes(type)) return null;
  const x = [1, ...model.kinds.slice(1).map((k) => +(type === k)), +weekend, (cars - h.shift) / 1000];
  const p = Math.max(0, x.reduce((s, v, i) => s + v * h.coef[i], 0));
  return { p, lo: Math.max(0, p + h.lo), hi: Math.max(0, p + h.hi), h };
}

// u: 고른 다가오는 공연 날(없으면 null), today: 보는 사람의 오늘 날짜
export function liveBlock(u, today) {
  if (!model) return "";
  const demo = demoCars !== null || demoNow !== null;
  const showDay = u && (u.date === today || demo);
  const head = live.n === null
    ? (live.err ? "실시간 주차 대수를 불러오지 못했어요." : "실시간 주차 대수를 불러오는 중이에요.")
    : `지금 공원 주차장에 차가 약 <b>${live.n.toLocaleString("ko-KR")}대</b> 있어요${live.at ? ` (${hm(live.at)} 기준)` : ""}.`;
  let line = "";
  if (live.n !== null && showDay) {
    const m = nowMin(), g = guess(u.type, u.weekday >= 5, m, live.n);
    line = g
      ? `이 대수로 다시 어림하면 오늘 나가는 길은 <b>${g.hi <= 0 ? "거의 붐비지 않을" : `약 ${round5(g.p)}분 붐빌`}</b> 것 같아요.${g.hi > 0 ? ` 범위로 말하면 ${floor5(g.lo)}~${ceil5(g.hi)}분이에요.` : ""}`
      : m < 17 * 60 ? "오후 5시부터 이 대수로 오늘 붐빌 시간을 다시 어림해 드려요." : "공연이 끝날 무렵이라 아래 지난 기록을 보세요.";
  } else if (live.n !== null) {
    line = "공연 날 오후 5시~10시에 열면 이 대수로 그날 붐빌 시간을 다시 어림해 드려요.";
  }
  const h19 = model.hours["19"];
  return `<div class="live" role="status">
      <p class="live-tag">시험 기능${demo ? " · 시연값" : ""}</p>
      <p>${head}</p>
      ${line ? `<p>${line}</p>` : ""}
      ${live.err ? `<button type="button" data-live="again">다시 불러오기</button>` : ""}
      <details>
        <summary>이 어림은 어떻게 하나요?</summary>
        <p class="fine">한국체육산업개발 실시간 주차현황(공원 전체 주차 대수)을 씁니다. 2025년 공연 날을 하루씩 빼고 맞혀 보면, 오후 7시 대수를 쓸 때 붐빈 시간 평균 오차가 ${h19.mae}분이었고(지난 기록만 쓰는 지금 방식은 ${h19.base_mae}분, ${h19.n}일), 실제 붐빈 시간이 범위 안에 든 날은 ${Math.round(h19.cover * 100)}%였어요. 실시간 값은 저녁에 2025 기록보다 수백 대 많게 나와서, 평일 저녁 기록으로 잰 차이(오후 7시 약 ${h19.shift}대)를 빼고 넣었어요. 이 차이는 공연 없는 평일 하루로 잰 값이라 공연 날 저녁에는 다를 수 있어요. 기관도 실시간 값이 실제와 다를 수 있다고 안내해요. 식은 ${model.made}에 만들었어요.</p>
      </details>
    </div>`;
}
