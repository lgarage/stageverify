import { Navigate, useParams } from "react-router-dom";

/** Legacy `/#/checkin/:orderId` → delivery deep link `/#/receive?id=` (bare `/receive` is recovery only). */
export function CheckinToReceiveRedirect() {
  const { orderId } = useParams<{ orderId: string }>();
  const id = orderId?.trim() ?? "";
  return (
    <Navigate
      to={id ? `/receive?id=${encodeURIComponent(id)}` : "/receive"}
      replace
    />
  );
}
