-- JEI — Migration 15: rename shipment stage "Sent to ID" → "Sent from SG"
-- Run in Supabase → SQL Editor BEFORE deploying the code update
update shipments set stage = 'Sent from SG' where stage = 'Sent to ID';
