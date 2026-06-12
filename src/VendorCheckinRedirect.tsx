import { Navigate, useParams } from "react-router-dom";

/** Legacy `/#/checkin/:orderId` → canonical `/#/receive?id=`. */
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
