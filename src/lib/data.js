import { useEffect, useState, useCallback } from "react";
import { supabase } from "./supabase";

// Loads everything the dashboard needs. Costs come back EMPTY for admin
// automatically — that's RLS doing its job, not the frontend hiding data.
export function useJEIData() {
  const [data, setData] = useState({
    customers: [], couriers: [], shipments: [], orders: [], costs: [], fx: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [customers, couriers, shipments, orders, costs, fx] = await Promise.all([
        supabase.from("customers").select("*").order("name"),
        supabase.from("couriers").select("*"),
        supabase.from("shipments").select("*"),
        supabase.from("orders").select("*"),
        supabase.from("shipment_costs").select("*"), // RLS: [] for admin
        supabase.from("fx_rates").select("*").single(),
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
      });
    } catch (e) {
      setError(e.message ?? "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return { ...data, loading, error, reload: load };
}

// ── Customers ──
export const updateCustomerRate = (id, rate_per_kg) =>
  supabase.from("customers").update({ rate_per_kg }).eq("id", id);
export const addCustomer = (name, rate_per_kg) =>
  supabase.from("customers").insert({ name, rate_per_kg }).select();

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
