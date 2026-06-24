import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

// Loads everything the dashboard needs. Costs come back EMPTY for admin
// automatically — that's RLS doing its job, not the frontend hiding data.
export function useJEIData() {
  const [data, setData] = useState({
    customers: [], couriers: [], shipments: [], orders: [], costs: [], fx: null, costEntries: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [customers, couriers, shipments, orders, costs, fx, costEntries] = await Promise.all([
        supabase.from("customers").select("*").order("name"),
        supabase.from("couriers").select("*"),
        supabase.from("shipments").select("*"),
        supabase.from("orders").select("*"),
        supabase.from("shipment_costs").select("*"), // RLS: [] for admin
        supabase.from("fx_rates").select("*").single(),
        supabase.from("cost_entries").select("*").order("cost_date", { ascending: false }),
      ]);
      const firstErr = [customers, couriers, shipments, orders, fx].find(r => r.error);
      if (firstErr?.error) throw firstErr.error;
      setData({
        customers: customers.data ?? [],
        couriers: couriers.data ?? [],
        shipments: shipments.data ?? [],
        orders: orders.data ?? [],
        costs: costs.data ?? [],
        fx: fx.data ?? { usd_idr: 16250, sgd_idr: 12050 },
        costEntries: costEntries.data ?? [],
      });
    } catch (e) {
      setError(e.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Locally patch one order's fields without refetching everything.
  const patchOrder = useCallback((orderId, patch) => {
    setData(d => ({
      ...d,
      orders: d.orders.map(o => o.id === orderId ? { ...o, ...patch } : o),
    }));
  }, []);

  // Locally patch one customer's fields without refetching.
  const patchCustomer = useCallback((customerId, patch) => {
    setData(d => ({
      ...d,
      customers: d.customers.map(c => c.id === customerId ? { ...c, ...patch } : c),
    }));
  }, []);

  return { ...data, loading, error, reload: load, patchOrder, patchCustomer };
}

// ── Customers ──
export const updateCustomerRate = (id, rate_per_kg) =>
  supabase.from("customers").update({ rate_per_kg }).eq("id", id);
export const updateCustomer = (id, patch) =>
  supabase.from("customers").update(patch).eq("id", id);
export const addCustomer = (name, rate_per_kg) =>
  supabase.from("customers").insert({ name, rate_per_kg }).select();
export const addCustomerFull = (data) =>
  supabase.from("customers").insert(data).select();
export const deleteCustomer = (id) =>
  supabase.from("customers").delete().eq("id", id);

// ── Orders: full CRUD ──
// Generate the next ORD-#### id based on existing orders.
export function nextOrderId(orders) {
  const nums = orders
    .map(o => parseInt(String(o.id).replace(/\D/g, ""), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 1000;
  return "ORD-" + (max + 1);
}
export const addOrder = (order) => supabase.from("orders").insert(order);
export const updateOrder = (id, patch) =>
  supabase.from("orders").update(patch).eq("id", id);
export const deleteOrder = (id) =>
  supabase.from("orders").delete().eq("id", id);

// Delete an order, and if its shipment has no other orders, delete the shipment too.
export async function cascadeDeleteOrder(orderId, shipmentId, allOrders) {
  const { error } = await deleteOrder(orderId);
  if (error) return { error };
  const remaining = allOrders.filter(o => o.shipment_id === shipmentId && o.id !== orderId);
  if (remaining.length === 0 && shipmentId) {
    await deleteShipment(shipmentId);
  }
  return { error: null };
}

// ── Shipments: create + stage transition ──
export function nextShipmentId(shipments) {
  const nums = shipments
    .map(s => parseInt(String(s.id).replace(/\D/g, ""), 10))
    .filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 2400;
  return "SHP-" + (max + 1);
}
export const addShipment = (shipment) =>
  supabase.from("shipments").insert(shipment);

// Add a shipment, retrying with incremented IDs if a unique constraint collision occurs.
export async function addShipmentSafe(shipment, existingShipments) {
  let id = shipment.id;
  let num = parseInt(String(id).replace(/\D/g, ""), 10) || 2400;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await addShipment({ ...shipment, id });
    if (!error) return { id, error: null };
    if (error.message && error.message.includes("duplicate key")) {
      num += 1;
      id = "SHP-" + num;
      continue;
    }
    return { id, error };
  }
  return { id, error: { message: "Could not allocate a unique shipment ID after several attempts." } };
}
export const updateShipment = (id, patch) =>
  supabase.from("shipments").update(patch).eq("id", id);
export const deleteShipment = (id) =>
  supabase.from("shipments").delete().eq("id", id);

// Stage change: also stamp when it happened
export const setShipmentStage = (id, stage) =>
  supabase.from("shipments")
    .update({ stage, stage_updated_at: new Date().toISOString() })
    .eq("id", id);

// Payment change: stamp its own timestamp
export const setShipmentPayment = (id, payment) =>
  supabase.from("shipments")
    .update({ payment, payment_updated_at: new Date().toISOString() })
    .eq("id", id);

// Save tracking numbers (per-leg). Pass only the fields you're changing.
export const setShipmentTracking = (id, patch) =>
  supabase.from("shipments").update(patch).eq("id", id);

// Mark an order as invoiced — moves it to Costs tab
export const markAsInvoiced = (id, patch) =>
  supabase.from("orders").update({ invoiced: true, invoiced_at: new Date().toISOString(), ...patch }).eq("id", id);

// Mark an order as completed — moves it to Completed tab
export const completeOrder = (id, patch) =>
  supabase.from("orders").update({ completed: true, completed_at: new Date().toISOString(), ...patch }).eq("id", id);

// Per-tab done flags (new parallel flow)
export const markTabDone = (id, tab, done = true) =>
  supabase.from("orders").update({ [`${tab}_done`]: done }).eq("id", id);

// ── Cost entries ──
export const getCostEntries = () =>
  supabase.from("cost_entries").select("*").order("cost_date", { ascending: false });

export const addCostEntry = (entry) =>
  supabase.from("cost_entries").insert(entry).select();

export const updateCostEntry = (id, patch) =>
  supabase.from("cost_entries").update(patch).eq("id", id);

export const deleteCostEntry = (id) =>
  supabase.from("cost_entries").delete().eq("id", id);
