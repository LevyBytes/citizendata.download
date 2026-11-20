import { HANGAR_SHIP_ID, MEDIA, UPGRADE_SHIPS } from "./page-sizes-and-ship-names.mjs";
import { upgradePriceCents } from "./generated-buyback-detail-and-upgrade-price.mjs";
import { json } from "./answer-shapes-and-paging.mjs";

// The store upgrade page's calls. RSI is told which upgrade the session looks at, then asked its price, which
// it gives in cents. It prices only the upgrade it was last told about. Null when the path is not one of them.
export function storeUpgradeAnswer(state, path, body) {
  if (path === "/api/account/v2/setAuthToken") return json({ success: 1, code: "OK", msg: "OK", data: {} });
  if (path === "/api/ship-upgrades/setContextToken") {
    // Naming no upgrade is accepted and leaves none named.
    if (body && Object.keys(body).length === 0) {
      state.upgradeContext = null;
      return json({ success: 1, code: "OK", msg: "OK", data: null });
    }
    const known = state.buybacks.some((buyback) => buyback.upgrade && buyback.id === body.pledgeId && Number(buyback.upgrade.fromShipId) === body.fromShipId
      && Number(buyback.upgrade.toShipId) === body.toShipId && Number(buyback.upgrade.toSkuId) === body.toSkuId);
    state.upgradeContext = known ? { from: body.fromShipId, to: body.toShipId, sku: body.toSkuId } : null;
    return json({ success: known ? 1 : 0, code: known ? "OK" : "ErrInvalidContext", msg: "", data: {} });
  }
  if (path === "/pledge-store/api/upgrade/graphql") {
    // One request can ask several things; RSI answers each in turn. A test can have RSI refuse such a request.
    const questions = Array.isArray(body) ? body : [];
    if (state.upgradeBatchRefused && questions.length > 1) return json([{ errors: [{ message: "Batched queries are not accepted." }] }], 400);
    const context = state.upgradeContext;
    const shipOf = (id) => ({
      id, name: `Synthetic Ship ${id}`,
      medias: { slideShow: (state.upgradeShipsWithoutLargeImage ?? []).includes(id) ? null : `${MEDIA}/upgrade-ship-${id}-large.jpg`, productThumbMediumAndSmall: `${MEDIA}/upgrade-ship-${id}.jpg` }
    });
    return json(questions.map((question) => {
      if (question?.operationName === "ships") {
        // A test can have RSI refuse the list, or leave ships out of it. While a buy-back's upgrade is the one
        // named, RSI lists the two ships of that upgrade only; otherwise it lists every ship.
        if (state.upgradeShipListRefused) return { errors: [{ message: "Cannot query field \"ships\"." }], data: null };
        const every = [...new Set(state.buybacks.filter((buyback) => buyback.upgrade).flatMap((buyback) => [Number(buyback.upgrade.fromShipId), Number(buyback.upgrade.toShipId)]))].sort((left, right) => left - right);
        const ids = context ? [context.from, context.to] : every;
        // With no upgrade named the list also holds the ships that CCU titles name, each under its own name.
        // A test can have RSI list a ship under a newer name than the one CCU titles use.
        const named = context ? [] : UPGRADE_SHIPS.map((name, index) => ({ ...shipOf(HANGAR_SHIP_ID + index), name: state.upgradeShipRenames?.[name] ?? name }));
        return { data: { ships: [...ids.map(shipOf), ...named].filter((ship) => !(state.unlistedUpgradeShips ?? []).includes(ship.id)) } };
      }
      if (question?.operationName !== "getPrice" || !context || question.variables?.from !== context.from || question.variables?.to !== context.sku) return { errors: [{ message: "No upgrade context." }], data: null };
      if ((state.unpricedUpgradeSkus ?? []).includes(context.sku)) return { data: { price: null } };
      const cents = upgradePriceCents(context.from, context.sku) + (state.upgradePriceRise ?? 0);
      return { data: { price: { amount: cents, nativeAmount: cents } } };
    }));
  }
  return null;
}
