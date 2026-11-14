/* 会員用商品の鍵（Shopify のテーマ Liquid）の決まり。**この1か所だけ**
   （8.24・2026-11-14・カジの依頼）。

   読み込み方
     ブラウザ … <script src="./shared/mgate.js"></script>
                 読み込むと globalThis.PJ_MGATE に入る
     テスト   … require('../shared/mgate.js')

   なぜ pj にも置くか
     判定そのものは Shopify のテーマ（shopify/snippets/member-gate.liquid）で
     動く。pj 側にも同じ決まりを置いて、
     **pj が書き出す CSV のタグ（grade-◯◯）でちゃんと見える・見えない**が
     機械で確かめられるようにする（tests/mgate.mjs）。
     Liquid を直したら、ここと tests/mgate.mjs も必ず直す。

   決まり（上から順に見る。Liquid も同じ順）
     ① 商品に member-list が無い → だれでも見られる（Omakase Ship の
        サービス・海外向け os- はここに入る）
     ② ログインしていない → /account/login（戻り先つき）
     ③ 顧客に member-staff がある → ぜんぶ見られる（社内の確認用）
     ④ 顧客に member-list が無い → /pages/members-only
     ⑤ 商品の grade-◯◯ と顧客の grade-◯◯ が1つも合わない
        → /pages/members-only?why=plan（「このプランではご覧いただけません」）
        ・商品に grade-◯◯ が1つも無いときは、会員ならだれでも見られる */
(function (root) {
  "use strict";

  var TAG_MEMBER = "member-list";      // 会員用商品／会員の印
  var TAG_STAFF = "member-staff";      // 社内の確認用（ぜんぶ見られる）
  var GRADE_PRE = "grade-";            // プランの印の頭
  var PAGE_NG = "/pages/members-only"; // 入れない人の行き先
  var LOGIN = "/account/login";        // Shopify のログイン

  function s(v) { return (v === null || v === undefined) ? "" : String(v); }
  /* タグは「配列」でも「カンマ区切りの文字」でも受ける
     （Shopify の CSV は文字、Liquid は配列）。 */
  function tags(v) {
    if (v === null || v === undefined) return [];
    var a = Array.isArray(v) ? v : s(v).split(",");
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var t = s(a[i]).trim();
      if (t) out.push(t);
    }
    return out;
  }
  function has(list, t) {
    var a = tags(list), x = s(t).toLowerCase();
    for (var i = 0; i < a.length; i++) if (a[i].toLowerCase() === x) return true;
    return false;
  }
  /* その並びの中の grade-◯◯ だけ。 */
  function gradesOf(v) {
    var a = tags(v), out = [];
    for (var i = 0; i < a.length; i++)
      if (a[i].slice(0, GRADE_PRE.length).toLowerCase() === GRADE_PRE)
        out.push(a[i].toLowerCase());
    return out;
  }
  function isMemberItem(pTags) { return has(pTags, TAG_MEMBER); }

  /* 判定。
     pTags … 商品のタグ（配列かカンマ区切り）
     cTags … 顧客のタグ。**null／undefined は「ログインしていない」**
             （ログイン済みでタグが無い人は [] を渡す）
     opt   … { url:'/products/one-3'（戻り先）, login:'/account/login',
               page:'/pages/members-only' }
     返すもの … { ok, why, to }
       why … ''（見られる）／'login'／'not-member'／'plan'
       to  … 飛ばす先（見られるときは ''） */
  function gateOf(pTags, cTags, opt) {
    var o = opt || {};
    var page = s(o.page) || PAGE_NG;
    var login = s(o.login) || LOGIN;
    /* ① 会員用でない商品は、だれでも見られる。 */
    if (!isMemberItem(pTags)) return { ok: true, why: "", to: "" };
    /* ② ログインしていない。 */
    if (cTags === null || cTags === undefined) {
      var back = s(o.url);
      return { ok: false, why: "login",
               to: login + (back ? ("?return_to=" + encodeURIComponent(back)) : "") };
    }
    /* ③ 社内の確認用。 */
    if (has(cTags, TAG_STAFF)) return { ok: true, why: "", to: "" };
    /* ④ 会員でない。 */
    if (!has(cTags, TAG_MEMBER)) return { ok: false, why: "not-member", to: page };
    /* ⑤ プランが合わない。 */
    var want = gradesOf(pTags);
    if (!want.length) return { ok: true, why: "", to: "" };
    var mine = gradesOf(cTags);
    for (var i = 0; i < want.length; i++)
      if (mine.indexOf(want[i]) >= 0) return { ok: true, why: "", to: "" };
    return { ok: false, why: "plan", to: page + "?why=plan" };
  }
  /* 一覧・検索・おすすめで「出すかどうか」だけ見るとき。 */
  function canSee(pTags, cTags) { return gateOf(pTags, cTags, {}).ok; }
  /* 見られない理由の日本語（画面とテストの表に出す）。 */
  var WHY_JA = {
    "": "見られる",
    login: "ログインへ",
    "not-member": "会員向けのご案内へ",
    plan: "このプランではご覧いただけません",
  };
  function whyJa(why) { return WHY_JA[s(why)] || s(why); }

  var API = {
    TAG_MEMBER: TAG_MEMBER, TAG_STAFF: TAG_STAFF, GRADE_PRE: GRADE_PRE,
    PAGE_NG: PAGE_NG, LOGIN: LOGIN, WHY_JA: WHY_JA,
    tags: tags, has: has, gradesOf: gradesOf, isMemberItem: isMemberItem,
    gateOf: gateOf, canSee: canSee, whyJa: whyJa,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  root.PJ_MGATE = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
