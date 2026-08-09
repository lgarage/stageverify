/** Pure helper: when should ReceivingPage re-init itemQtys from deliveryDetails.items? */
export function shouldReinitItemQtys(
  prev: { deliveryId: string; itemCount: number } | null,
  deliveryId: string,
  itemCount: number,
): boolean {
  if (!prev || prev.deliveryId !== deliveryId) return true;
  // Bootstrap shell paints with items=[]; re-init when hydrate fills items.
  if (prev.itemCount === 0 && itemCount > 0) return true;
  return false;
}
