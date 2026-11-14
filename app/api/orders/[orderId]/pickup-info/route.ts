import { NextResponse } from "next/server";

import { requireAccessContext } from "@/lib/auth";
import {
  getOrderPickupInfo,
  listPickupTemplates,
  pickupInfoInputSchema,
  saveOrderPickupInfo,
  type PickupInfoState,
} from "@/lib/order-pickup-info";

type Params = Promise<{ orderId: string }>;

function serialize(state: PickupInfoState) {
  return {
    ...state,
    readyAt: state.readyAt?.toISOString() ?? null,
    sentAt: state.sentAt?.toISOString() ?? null,
  };
}

/**
 * One trip's pickup information (lib/order-pickup-info.ts): GET for the
 * card in the order panel, with the templates it can use; PUT saves the
 * template and this trip's code, and marks it ready or back to draft.
 */
export async function GET(_request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, vehicleIds } = await requireAccessContext();
  const found = await getOrderPickupInfo(workspace.id, orderId, vehicleIds);
  if (!found) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  const templates = await listPickupTemplates(workspace.id, found.order.vehicleId);
  return NextResponse.json({ info: serialize(found.state), templates });
}

export async function PUT(request: Request, { params }: { params: Params }) {
  const { orderId } = await params;
  const { workspace, user, vehicleIds } = await requireAccessContext();
  const parsed = pickupInfoInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID" }, { status: 400 });
  const result = await saveOrderPickupInfo({
    workspaceId: workspace.id,
    orderId,
    vehicleIds,
    actor: user.name,
    data: parsed.data,
  });
  if (!result.ok) {
    const status = result.error === "NOT_FOUND" ? 404 : 400;
    return NextResponse.json(
      { error: result.error, info: result.state ? serialize(result.state) : null },
      { status },
    );
  }
  return NextResponse.json({ info: serialize(result.state) });
}
