import { MEDIA, MEMBERS_PER_PAGE, REFERRALS_PER_PAGE } from "./page-sizes-and-ship-names.mjs";
import { json, paged } from "./answer-shapes-and-paging.mjs";

export function graphqlAndMemberAnswers({ state, handle, organization }) {
  function referralList(variables) {
    const converted = variables.converted === true;
    const legacy = variables.campaignId === "1";
    const rows = converted ? (legacy ? state.referrals.legacyRecruits : state.referrals.recruits) : state.referrals.prospects;
    const slice = paged(rows, variables.page, REFERRALS_PER_PAGE);
    return [{ data: { referralRecruitsList: { data: slice.rows.map((row) => ({ ...row })), recruitsCount: legacy ? state.referrals.legacyRecruits.length : state.referrals.recruits.length, prospectsCount: state.referrals.prospects.length } } }];
  }

  function graphql(body) {
    const operations = Array.isArray(body) ? body : [body];
    const first = operations[0]?.operationName;
    if (first === "GetAuthenticatedUser") {
      return json([{ data: { account: {
        isAnonymous: false, nickname: handle, displayname: "Synthetic Citizen", profileUrl: `/en/citizens/${handle}`,
        badges: [{ id: 1, title: "Civilian" }, { id: 2, title: "Synthetic Tester" }, { id: null, title: null }],
        badgeIcons: { favorite: { icon: `${MEDIA}/title-civilian.png`, name: "Civilian" } }
      } } }]);
    }
    if (first === "getRouteInfo") {
      return json([{ data: { routeInfo: {} } }, { data: { accountDashboard: { account: { featuredBadges: [{ image: { src: `${MEDIA}/badge-tester.png`, title: "Synthetic Tester" }, href: "/en/account/badges" }] } } } }]);
    }
    if (first === "GetReferralRecruitsList") return json(referralList(operations[0].variables ?? {}));
    return json([{ errors: [{ message: "Unknown synthetic operation" }] }], 400);
  }

  function members(body) {
    if (body.symbol !== organization.sid) return json({ success: 0, data: null });
    const slice = paged(state.members, body.page, MEMBERS_PER_PAGE);
    const rows = slice.rows.map((member) => member.restricted
      ? '<li class="member-item js-member-item org-visibility-R"><span class="membercard"></span></li>'
      : `<li class="member-item js-member-item org-visibility-V ${member.main ? "org-main" : "org-affiliate"}"><a class="membercard" href="/citizens/${member.handle}"><span class="thumb"><img src="${MEDIA}/avatar-m.jpg" alt=""></span><span `
        + `class="frontinfo"><span class="name-wrap"><span class="name">${member.name}</span><span class="nick">${member.handle}</span></span><span class="rank"><span class="name">${member.rank}</span></span><span `
        + `class="ranking-stars">${'<span class="active"></span>'.repeat(member.stars)}</span></span><span class="rolelist"><span class="role">Pilot</span></span></a></li>`);
    return json({ success: 1, data: { totalrows: state.members.length, html: rows.join("") } });
  }

  return { graphql, members };
}
