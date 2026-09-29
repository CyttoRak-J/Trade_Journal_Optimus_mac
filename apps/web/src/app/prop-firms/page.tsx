import { Suspense } from "react";
import { PropFirmTracker } from "@/components/prop-firm-tracker";
export default function PropFirmsPage() {
  return (
    <Suspense>
      <PropFirmTracker />
    </Suspense>
  );
}
