---
id: barbershop
title: Barbershop booking
language: en
---

# Idea

Online booking for a small barbershop with two barbers. Clients book a haircut or a beard trim on a website without creating an account; the barbers see their own day; the owner manages all bookings and sees revenue.

# Interview

## Users and roles

### Q: Who uses the app?
A: Clients book on a public page without an account. Two barbers, Ivan and Sergey, sign in to see their own appointments. The owner signs in to see and cancel all bookings and to see revenue.

### Q: Which accounts should exist from the start?
A: Owner: owner@barber.test, password owner-pass-1. Barber Ivan: ivan@barber.test, password ivan-pass-1. Barber Sergey: sergey@barber.test, password sergey-pass-1. Seed them.

### Q: What may a barber do?
A: A barber sees only their own appointments on the schedule page. Barbers cannot open the revenue report; send them to /schedule instead.

## Data

### Q: What services do you offer?
A: Haircut, 30 minutes, $25.00. Beard trim, 30 minutes, $15.00. Seed both.

### Q: What do you store about a booking?
A: Barber, service, date and start time, the client's name and phone, and whether it is cancelled.

## Key scenarios

### Q: How does a client book?
A: On the public page /book: a select labelled "Barber" (options Ivan and Sergey), a select labelled "Service" (Haircut, Beard trim), a date field labelled "Date", then a select labelled "Time" that lists only the free start times of that barber on that day, then fields "Your name" and "Phone", and a button "Book". After booking the page shows "Booking confirmed".

### Q: What are the opening hours?
A: Every day from 10:00 to 18:00. Start times every 30 minutes, 10:00 to 17:30, shown as 24-hour HH:MM.

### Q: What if two clients try to take the same time?
A: Only the first gets it. The second sees "This time is no longer available" and nothing is booked.

### Q: Which mistakes should the booking form catch?
A: Without a name show "Enter your name". Without a phone show "Enter your phone number". A date in the past shows "Choose a future date".

### Q: What does the schedule look like?
A: Staff sign in at /login (fields "Email" and "Password", button "Sign in") and see /schedule: a date field labelled "Date" and a table of that day's bookings with columns Time, Barber, Service and Client. It opens on today; /schedule?date=YYYY-MM-DD opens a given day. The owner sees every barber's bookings, a barber only their own.

### Q: How does the owner cancel a booking?
A: Each row of the owner's schedule has a "Cancel" button. After a confirmation button "Yes, cancel" the booking disappears from the schedule and its time is free again on /book.

## Reports

### Q: Which report do you need?
A: /reports for the owner: fields "From" and "To" (dates) and a button "Show". It shows the number of bookings and "Total: $X.XX" — the sum of service prices of bookings in that range that are not cancelled.

## Integrations

### Q: Do you need payments, SMS or email?
A: No, not in the first version.

## Constraints

### Q: Anything else?
A: English interface, prices in US dollars. Works on a phone for clients.
