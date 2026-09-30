---
id: warehouse
title: Mini warehouse
language: en
---

# Idea

Stock keeping for a small shop's storeroom: a list of products with how many are in stock, receiving and shipping goods, warnings when something runs low, and a report of what came in and went out.

# Interview

## Users and roles

### Q: Who uses the app?
A: The owner and one storekeeper, both signed in. The owner manages products; both receive and ship goods.

### Q: Which accounts should exist from the start?
A: Owner: owner@stock.test, password owner-pass-1. Storekeeper: keeper@stock.test, password keeper-pass-1. Seed them.

### Q: What is only for the owner?
A: Creating products, changing a product's minimum stock and deleting products. The storekeeper does not see the "New product" and "Delete product" buttons, and the server refuses those actions for them.

## Data

### Q: What do you store about a product?
A: Name, SKU (unique code), unit (for example pcs or kg) and minimum stock. The quantity in stock comes from receipts and shipments.

### Q: What do you store about a movement?
A: Product, receipt or shipment, quantity (a whole number, at least 1), date and time, an optional note, and who made it.

## Key scenarios

### Q: How are products added?
A: Sign in at /login (fields "Email" and "Password", button "Sign in"). /products lists products with columns Name, SKU and In stock, and a search field labelled "Search products". The owner has a "New product" button that opens a form with "Name", "SKU", "Unit", "Minimum stock" and a button "Save product"; after saving the product page shows "Product saved".

### Q: What if a SKU is used twice?
A: Show "A product with this SKU already exists" and save nothing.

### Q: How do receiving and shipping work?
A: The product page (open it by clicking the product's name in the list) shows "In stock: N". It has buttons "Receive" and "Ship"; each opens fields "Quantity" and "Note" and a button "Save". After saving, "In stock" shows the new quantity.

### Q: What if someone ships more than is in stock?
A: Refuse with "Not enough stock" and change nothing.

## Reports

### Q: How do you want to see low stock?
A: In the product list, a product whose stock is below its minimum shows "Low stock" in its row. /low-stock lists only those products.

### Q: Which report do you need?
A: /reports: fields "From" and "To" (dates) and a button "Show", then a table with one row per product that moved in that range: columns Product, Received and Shipped (total quantities).

## Integrations

### Q: Do you need barcode scanners, accounting export or suppliers?
A: No, not in the first version.

## Constraints

### Q: Anything else?
A: English interface. Works on a laptop.
