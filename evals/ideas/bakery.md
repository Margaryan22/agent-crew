---
id: bakery
title: Bakery orders
language: en
---

# Idea

Order book for a small bakery that takes pre-orders by phone: staff enter orders with pickup dates, the baker sees how much of each product to bake for a day, orders move from new to picked up, and the owner sees revenue.

# Interview

## Users and roles

### Q: Who uses the app?
A: The owner and a baker, both signed in. Customers do not use the app: staff enter orders taken by phone.

### Q: Which accounts should exist from the start?
A: Owner: owner@bakery.test, password owner-pass-1. Baker: baker@bakery.test, password baker-pass-1. Seed them.

### Q: What may the baker do?
A: Everything with orders and the production list. Only the owner opens the revenue report; send the baker to /orders instead.

## Data

### Q: What do you sell?
A: Sourdough loaf $6.00, Croissant $2.50, Birthday cake $30.00. Seed these products.

### Q: What do you store about an order?
A: Customer name, phone, pickup date, items (product and quantity, at least 1), status and the order number. The total is the sum of price × quantity.

## Key scenarios

### Q: How is an order entered?
A: Sign in at /login (fields "Email" and "Password", button "Sign in"). /orders/new has "Customer name", "Phone", "Pickup date", and item rows with a select "Product" and a field "Quantity"; a button "Add item" adds another row. The form shows "Total: $X.XX" as items change. The button "Save order" saves it and the order page shows "Order saved" and "Order #N".

### Q: Which mistakes should the form catch?
A: A pickup date in the past shows "Choose a future pickup date". A quantity below 1 shows "Quantity must be at least 1". Without a customer name show "Enter the customer's name".

### Q: How do you track orders?
A: /orders has a date field "Pickup date" (it opens on today; /orders?date=YYYY-MM-DD opens a given day) and lists that day's orders with their number, customer, total and status. Statuses: New, Baking, Ready, Picked up, Cancelled. On the order page the buttons "Start baking", "Mark ready" and "Picked up" move the order forward, and "Cancel order" cancels it; the page shows "Status: <status>".

### Q: What does the baker need to see?
A: /production with a date field "Pickup date" (and /production?date=YYYY-MM-DD) listing each product with the total quantity to bake for that day, as rows "<product> — <quantity>", counting all orders of the day except cancelled ones.

## Reports

### Q: Which report do you need?
A: /reports for the owner: fields "From" and "To" (dates) and a button "Show". It shows "Revenue: $X.XX" — the total of orders picked up with a pickup date in that range.

## Integrations

### Q: Do you need online payments or notifications?
A: No, not in the first version.

## Constraints

### Q: Anything else?
A: English interface, prices in US dollars.
