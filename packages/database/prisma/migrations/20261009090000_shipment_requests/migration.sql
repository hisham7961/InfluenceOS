-- Campaigns whose creators all receive products, and shipment requests the
-- app created itself (a confirmed creator who gets products).
ALTER TABLE "Campaign" ADD COLUMN "shipsProducts" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ProductShipment" ADD COLUMN "autoCreated" BOOLEAN NOT NULL DEFAULT false;
