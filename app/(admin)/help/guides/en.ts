import type { Guide, HelpCopy } from "./types";

export const copy: HelpCopy = {
  title: "Help",
  intro: "How to use every page of TATO: what it is for, where the buttons are, and what to watch for. Screenshots come from a demo account; yours shows your own cars and trips.",
  pick: "Choose a page",
  open: "Open this page",
  steps: "Steps",
  tips: "Good to know",
  screenshotAlt: "Screenshot of {page}",
  screenshotNote: "Demo account. The numbers match the steps below; click to enlarge.",
  close: "Close",
  contactTitle: "Still stuck?",
  contactBody: "Press Contact at the bottom left, describe the problem and attach a screenshot or screen recording. We reply as soon as we can.",
};

export const guides: Guide[] = [
  {
    key: "dashboard",
    title: "Dashboard",
    summary: "Start each day here: who picks up and returns today and tomorrow, any overlapping trips, and how the month is going.",
    sections: [
      {
        heading: "Today's work",
        shot: "dashboard-today",
        steps: [
          "The numbers at the top: Today in use, Pickups today, Returns today.",
          "Conflicts counts trips on one car that overlap. A red number comes first; find the red bars on the calendar.",
          "The pickup & return list shows every handover today by time: a black tag is a return, a white one a pickup, with the place after the car. Click a row to open the trip. The same list for tomorrow sits below, so deliveries and cleaning can be planned a day ahead.",
          "Quick CSV import takes a Turo CSV right here; it is the same as the CSV Imports page.",
        ],
      },
      {
        heading: "Getting started, recently viewed and recent actions",
        shot: "dashboard-start",
        steps: [
          "A new account sees Getting started: add your cars, bring in your Turo trips, add the owners, set each owner's terms, share a statement, invite your team. Click an unfinished step to go to its page.",
          "The list disappears once every step is done, or press Hide.",
          "Recently viewed lists the last three trips you opened.",
          "Recent actions is folded; click it to see what the team changed, or open the full activity log.",
        ],
      },
    ],
    tips: ["Net earnings, Trips, Active vehicles and Avg per trip count this month's imported trips. A Turo trip has an amount only after its CSV is imported."],
  },
  {
    key: "assistant",
    title: "Assistant",
    summary: "Alerts that need you, an AI you can ask about the fleet, and the Turo emails pulled in automatically.",
    sections: [
      {
        heading: "Alerts, questions and the Turo inbox",
        shot: "assistant-main",
        steps: [
          "Alerts are found by rules in code: overlapping trips, a pickup with no cleaning task, Turo email sync that stopped. Open goes to the thing to fix.",
          "When it is handled, press Got it. An alert also closes itself when its condition clears.",
          "Rescan checks again right away.",
          "Ask about the fleet in the middle, or press an example such as \"What's happening today?\". Answers come from your live data.",
          "Under What the AI remembers, write a rule it should always follow and press Remember. Answers and guest-reply drafts follow it from then on.",
          "The Turo inbox pulls in the emails Turo sends you, the ones needing a reply first; Sync now fetches new mail immediately.",
        ],
      },
    ],
    tips: ["Turo cannot be written to: when a car is booked on your own website, someone has to block those dates on Turo, or the car can be booked twice. The assistant reminds you."],
  },
  {
    key: "messages",
    title: "Messages",
    summary: "Every Turo guest message, grouped by conversation, with a translation beside it.",
    sections: [
      {
        heading: "Find what needs a reply and clear it",
        shot: "messages-main",
        steps: [
          "Needs reply shows only conversations still waiting; Scheduled holds the ones you set to send later.",
          "Pick a conversation on the left to read all of it on the right, each message with its translation.",
          "Turo opens the conversation on Turo, where you reply to the guest.",
          "Switch between Translation and Summary; a long thread reads faster as a summary.",
          "When it is handled, press Mark handled and it leaves Needs reply.",
        ],
      },
    ],
    tips: [
      "The line at the top of a conversation is the trip's dates and amount; Trip on the right opens it.",
      "Car not identified means the email's make and model fit several cars, or none. TATO never guesses; set the car on the trip yourself.",
    ],
  },
  {
    key: "updates",
    title: "Updates",
    summary: "Everything that happens on Turo as one timeline: new bookings, changes, cancellations, pickups, returns, payouts and guest messages.",
    sections: [
      {
        heading: "Filter, then jump to the details",
        shot: "updates-main",
        steps: [
          "Press a chip at the top to see one kind, such as New booking, Cancelled or Payout; tick Needs a reply for guest messages still waiting.",
          "Order opens the trip in TATO.",
          "Conversation opens the guest's message thread.",
          "Open on Turo ↗ opens the original page on Turo.",
        ],
      },
    ],
  },
  {
    key: "calendar",
    title: "Calendar",
    summary: "Every car on one timeline: which days it is booked, free or in for service, at a glance. New trips, service records, notes and a car's month view all start here.",
    sections: [
      {
        heading: "The toolbar",
        shot: "calendar-toolbar",
        steps: [
          "Today jumps back to today; ‹ › move a screen at a time, or drag the empty grid sideways.",
          "New creates an offline trip, a recurring order or a car.",
          "New service record logs maintenance, repairs or mileage, drawn on the calendar as amber stripes.",
          "Filters narrows by car, owner and source; Prices, Sync and Tools hold price changes, Turo sync and bulk actions.",
          "The search box finds renters, phones, plates, owners and notes: trips that do not match fade, and matches from all history are listed below.",
          "The legend explains the bar colours: blue is not with the owner yet, green is with the owner or offline, red is an overlap, amber is service, a dashed grey strip is cancelled; the purple line is now.",
        ],
      },
      {
        heading: "Reading the calendar",
        shot: "calendar-grid",
        steps: [
          "The column headed Today is today, and the purple line marks the current time; trips that are over are faded.",
          "Each row is a car and each bar a trip, with the pickup time at its top left and the return time at its top right. Click a bar to open the trip.",
          "The small square beside a plate opens that car's month view.",
          "Amber stripes are a service record; click one to edit or delete it.",
        ],
      },
      {
        heading: "Pick days: a trip, a service record, prices or a note",
        shot: "calendar-pick-days",
        steps: [
          "On a car's row click the first day, then the last; the days between are picked (amber). Click a day again to drop it.",
          "A bar appears at the bottom: Create order makes an offline trip on those days.",
          "New service record logs the car as in for service on those days.",
          "Adjust prices… changes those days' prices on your own website.",
          "Type a note and press Enter to leave a grey note on the calendar; click a note to delete it.",
        ],
      },
      {
        heading: "Trip details",
        shot: "calendar-order",
        steps: [
          "The chips at the top say where the trip stands: its source, a phase such as \"Returns tomorrow 14:00\", any overlap, and whether its owner has it.",
          "View Turo receipt and View on Turo open the trip on Turo.",
          "Sync to owner share puts the trip in the owner's ledger; the bar turns green.",
          "The pencil beside a field edits it; save or press Enter, Esc cancels. Times and places sit in the trip card at the top, with one line when pickup and return are the same place.",
          "Accounting reads top to bottom: money in (rent, boost and so on) and money taken off (discounts, sales tax and so on), line for line with Turo's receipt, then Other charges that do not come from Turo (such as the cleaning fee), and the net income at the bottom. The pencil left of each amount changes it (a changed amount is underlined; hover for the CSV's). When the car has an owner, the tick on the right says whether that line counts toward the owner's share, for this trip only. The owner's share below is what this trip puts on the owner's statement.",
          "Empty fields wait behind Add, such as deposit, payment method and contract number.",
          "At the bottom, duplicate the trip or delete it (deleted trips go to the Trash and can be restored).",
        ],
      },
      {
        heading: "Create a trip by hand",
        shot: "calendar-new-order",
        steps: [
          "Choose the car; type a plate to search.",
          "Enter the renter, phone and price.",
          "Set the pickup and return dates and times.",
          "Create the order. It saves even when it overlaps another trip, and the bar turns red to tell you.",
        ],
      },
      {
        heading: "New service record",
        shot: "calendar-service",
        steps: [
          "Choose the car and the kind of record (maintenance, repair, mileage and so on).",
          "Enter the start and end dates.",
          "Add the mileage and cost at the time, and a description, if you like.",
          "Save. Those days show amber stripes, and trips can still overlap them.",
        ],
      },
      {
        heading: "One car's month view",
        shot: "calendar-month",
        steps: [
          "↑ Earlier months shows another half year back; scroll to the bottom for ↓ Later months.",
          "Click any trip to open it.",
        ],
      },
      {
        heading: "Tools",
        shot: "calendar-tools",
        steps: [
          "Select turns on bulk mode: click bars to pick them, then sync them to owners at once from the bar at the bottom.",
          "Subscribe gives a calendar feed address for the calendar app on your phone or computer.",
          "Download vehicle orders exports one car's trips as a spreadsheet.",
          "Drag Day width to show more days or see them larger.",
        ],
      },
      {
        heading: "Filters",
        shot: "calendar-filters",
        steps: ["Filter by car, owner and source (Turo or offline) to see only the cars you care about."],
      },
    ],
    tips: [
      "A car can hold overlapping trips: saving works, the bar turns red, and the trip names what it clashes with.",
      "Two trips less than six hours apart get an amber ⇄ marker at the handover, so the car is turned around in time.",
      "The small numbers on free days are that car's price on your own booking website, shown only for cars open to direct booking.",
    ],
  },
  {
    key: "orders",
    title: "Orders",
    summary: "Every trip in one list: search, filter, export, create offline trips, act on many at once, and each trip's own page.",
    sections: [
      {
        heading: "Find and export trips",
        shot: "orders-list",
        steps: [
          "Create offline order opens a form to enter an offline trip (next section).",
          "Search by renter, car, plate, owner, phone, date, note or order number, then press Search.",
          "Filters narrows by status, source, car and dates; press Apply.",
          "Export to Excel exports the trips the filters show.",
          "Click a row to open the trip, in the same panel the calendar uses.",
        ],
      },
      {
        heading: "Create an offline trip",
        shot: "orders-create",
        steps: [
          "Paste the renter's message (WeChat, text) into this box.",
          "Read message fills in the car, name, phone, dates and amount for you to check.",
          "Or type the renter name and phone yourself, plus pickup and return places, deposit, payment method, contract number and notes.",
          "Set the pickup and return dates and times.",
          "Create offline order. It saves even when it overlaps another trip, and shows red on the calendar.",
        ],
      },
      {
        heading: "Act on many",
        shot: "orders-bulk",
        steps: [
          "Tick the boxes beside trips, or Select all on this page.",
          "A bar appears at the bottom: Sync to owners puts the picked trips into their owners' ledgers at once.",
          "Offline trips can also be marked paid (or unpaid) together.",
          "Delete moves the picked trips to the Trash.",
        ],
      },
      {
        heading: "A trip's own page",
        shot: "orders-detail",
        steps: [
          "Get directions opens the pickup place in your maps app.",
          "View on Turo ↗ opens the trip on Turo; below it, Guest messages → goes to the conversation, with the pickup, return, amount and fee breakdown on the page.",
        ],
      },
    ],
    tips: [
      "A Turo trip's amount is what Turo pays you after its fees, and arrives with the CSV; until then it shows —.",
      "Deleted trips go to the Trash, where they can be restored.",
    ],
  },
  {
    key: "imports",
    title: "CSV Imports",
    summary: "Bring in Turo's earnings CSV: trip amounts, fee breakdowns and owner payouts all come from it. It can also sync on its own.",
    sections: [
      {
        heading: "Import a CSV",
        shot: "imports-steps",
        steps: [
          "Open Turo earnings page and export the CSV there.",
          "Back here, Choose file and pick the CSV you downloaded.",
          "Say which Turo account it is from: Main account or Another account…. The wrong one files the cars under another account.",
          "Import. Cars that are not in your fleet yet are listed for you to confirm before they are created.",
          "The import log lists each file with who imported it, when, the rows and the result.",
        ],
      },
      {
        heading: "Set up automatic sync",
        shot: "imports-sync",
        steps: [
          "On Turo, copy the request that downloads the CSV (as curl) and paste all of it here.",
          "The address, year and headers fill in from it, and can be edited.",
          "Save sync settings; new CSVs are then fetched on a schedule.",
        ],
      },
    ],
    tips: [
      "Importing the same CSV again updates trips rather than duplicating them.",
      "Check these at the top lists upcoming trips whose car was never confirmed by plate; open them and confirm each.",
      "Past the free vehicle allowance, buy enough slots under Buy Quota before importing.",
    ],
  },
  {
    key: "vehicles",
    title: "Vehicles",
    summary: "Each car's details: plate, model, owner, cleaning fee, TATO commission, Turo plan % and trip count.",
    sections: [
      {
        heading: "The list",
        shot: "vehicles-list",
        steps: [
          "Create vehicle opens the form to add a car (next section).",
          "Search by plate, model, VIN, owner or listing.",
          "Edit vehicle changes everything about a car.",
          "Archive vehicle, for a car you no longer rent: new trips are no longer assigned to it, and its past trips and ledger stay.",
        ],
      },
      {
        heading: "Add a car",
        shot: "vehicles-create",
        steps: [
          "Enter the plate number, and a nickname if you like.",
          "Enter the brand, model and year; VIN is optional.",
          "Choose the car's owner (leave Unassigned owner for now if there is none).",
          "TATO commission % is your cut of the owner's share.",
          "Cleaning fee comes off the owner after each return.",
          "Turo plan % is the share Turo pays you; blank means 75%.",
          "Add vehicle. There is room for a pickup password, tax, Turo listing name and notes too.",
        ],
      },
      {
        heading: "Edit a car",
        shot: "vehicles-edit",
        steps: [
          "The dialog has the same fields as adding; change what you need.",
          "Save. A new cleaning fee asks from which day it applies, and only trips starting on or after it are charged it.",
        ],
      },
    ],
  },
  {
    key: "vehicle-roi",
    title: "Vehicle returns",
    summary: "What each car has earned and how long it takes to pay back; before buying the next one, check the rent estimate and the ranking.",
    sections: [
      {
        heading: "Fleet",
        shot: "roi-fleet",
        steps: [
          "Three tabs at the top: the fleet, the rent estimate and which car to buy.",
          "Search by plate, make, model, year or owner.",
          "Click a column header, such as 12 mo, to sort by it.",
          "Enter the purchase price under Add price to get the annual return.",
        ],
      },
      {
        heading: "Rent estimate",
        shot: "roi-estimate",
        steps: [
          "Choose the brand.",
          "Choose the model.",
          "Choose the year; the daily rate and monthly income it would earn with you are estimated below.",
          "The method button shows how the estimate is made.",
        ],
      },
      {
        heading: "Which car to buy",
        shot: "roi-ranking",
        steps: [
          "Choose the arrangement: TATO buys the car, or an owner partners with us.",
          "Choose what to rank by: total ROI, cash yield, annual net cash and more.",
          "Enter the lowest and highest price in your budget.",
          "Cost assumptions holds insurance, depreciation and the rest; the ranking follows your changes.",
        ],
      },
    ],
  },
  {
    key: "owners",
    title: "Owner revenue share",
    summary: "Each owner's cars, commission terms, fee rules, ledger and balance, and a read-only link to send them.",
    sections: [
      {
        heading: "The owner list",
        shot: "owners-list",
        steps: [
          "+ New owner adds an owner.",
          "+ Quick reimbursement records something you paid for a car's owner (last section).",
          "Search by owner, contact, notes or car.",
          "Click an owner's card for their page; the balance on it is what you currently owe them.",
        ],
      },
      {
        heading: "New owner",
        shot: "owners-new",
        steps: ["Enter the owner's name.", "Enter their email (statement notices go there); phone, company and notes are optional.", "Create owner."],
      },
      {
        heading: "Owner page: profile",
        shot: "owners-profile",
        steps: ["Open ledger goes to this owner's ledger.", "Change the name, email, phone, company and notes.", "Save."],
      },
      {
        heading: "Owner page: management commission",
        shot: "owners-terms",
        steps: [
          "Enter the commission %; 20 means 20%.",
          "Choose the day it starts: trips starting that day or later use the new terms, earlier ones are untouched.",
          "Choose who the rent reaches first: your company account (you pay the owner after commission) or the owner's (they pay you the commission).",
          "Save these terms. The terms history below records each change.",
        ],
      },
      {
        heading: "Owner page: fee sharing",
        shot: "owners-fees",
        steps: [
          "For each service charge, such as Delivery, choose whether it goes to the owner or the company keeps it.",
          "How kept fees come off: at the price the guest paid, or at what Turo paid out.",
          "Save fee sharing. The net calculation below shows what the owner actually receives.",
          "Use this for every owner applies the same basis to all owners at once.",
        ],
      },
      {
        heading: "Owner page: share link and cars",
        shot: "owners-share",
        steps: [
          "Create share link makes a read-only link for the owner: they see their ledger, monthly statements and their cars' calendar, and cannot change anything.",
          "Tick the owner's cars in the picker; a car that belonged to someone else moves to this owner.",
          "Save vehicle assignments.",
          "Delete owner sits in the danger zone at the bottom; make sure no balance is outstanding first.",
        ],
      },
      {
        heading: "The ledger (statement)",
        shot: "owners-ledger",
        steps: [
          "+ Add reimbursement records something you paid for the owner, such as a repair or insurance.",
          "+ Record payment records money you paid the owner, or they paid you.",
          "+ Manual adjustment records any other plus or minus.",
          "↻ Resync auto rows recalculates the rows made from trips (marked auto) with the latest trips and rules.",
          "✉ Tell the owner the statement is ready emails them to look.",
          "Set dates to see one period; switch owner on the right. Each row can be edited or deleted.",
        ],
      },
      {
        heading: "Quick reimbursement",
        shot: "owners-reimburse",
        steps: [
          "Choose the car; the reimbursement is filed under its owner.",
          "Enter the amount, date and a note (required), and attach the receipt (image or PDF) if you have it.",
          "Save, and it appears in the owner's ledger.",
        ],
      },
    ],
  },
  {
    key: "direct-booking",
    title: "Direct Booking",
    summary: "Your own rental website: which cars are listed, pricing rules, pickup places, confirmation email, rental agreement, change requests, deposits, dynamic pricing, ads and the site itself.",
    sections: [
      {
        heading: "Vehicles: listing and prices",
        shot: "booking-vehicles",
        steps: [
          "The tabs along the top switch between the direct booking settings; Vehicles is the car list.",
          "Search by plate, model or Turo ID.",
          "Filter by Live, Not listed, No photos and more to find the cars that need work.",
          "The listing switch decides whether the car appears on the site; the daily price can be edited right in the table.",
          "Preview shows the car as renters see it.",
          "Edit changes the car's daily price, insurance, deposit, tax and photos on the site.",
        ],
      },
      {
        heading: "Edit a car",
        shot: "booking-vehicle-edit",
        steps: ["Tick the public booking page to put the car on the site; then set the daily price for free days (an AI suggestion is shown), daily insurance, deposit, tax, weekly discount, minimum days, mileage, the page intro and features (seats, winter tyres, CarPlay and so on). Anything left blank follows the fleet defaults in Pricing rules."],
      },
      {
        heading: "Pricing rules (fleet defaults)",
        shot: "booking-pricing-rules",
        steps: [
          "Pricing rules sets the defaults for the whole fleet; a car that differs is changed under Vehicles.",
          "Minimum rental days, weekly discount, daily km, excess km rate and return grace set the length and mileage terms.",
          "Buffer between trips keeps time before and after each trip for cleaning and handover; new bookings cannot land in it.",
          "Insurance / day, Security deposit and the taxes decide the other charges a renter pays.",
          "Cancellation policy decides how much a renter gets back when they cancel.",
          "Save fleet policy. The month-by-month seasonal factors and the extras sit below.",
        ],
      },
      {
        heading: "Pickup & return places",
        shot: "booking-locations",
        steps: [
          "Pickup & return lists the places renters can choose: name, address and one-way fee; the first row, or the one marked default, is the default.",
          "Add a location adds a row; save the locations when done. Clearing a name deletes its row.",
        ],
      },
      {
        heading: "Confirmation email",
        shot: "booking-email",
        steps: [
          "Confirmation email is the message a renter receives after paying.",
          "The send switch: turn it off if you confirm by phone or text instead.",
          "Edit the subject and body; the preview on the right follows as you type.",
          "Click a variable such as {renterName} to insert the renter's name, the car, the dates and more.",
        ],
      },
      {
        heading: "Rental agreement",
        shot: "booking-agreement",
        steps: [
          "Rental agreement is the terms every renter signs, one set for all cars.",
          "Edit each clause's title and text.",
          "Use the arrows to reorder clauses, or delete one.",
          "Save agreement. Changes apply from the next booking; agreements already sent stay as they were.",
        ],
      },
      {
        heading: "Change requests",
        shot: "booking-requests",
        steps: ["Change requests lists renters' requests to move, extend or cancel a booking; approve or decline each."],
      },
      {
        heading: "Deposits",
        shot: "booking-deposits",
        steps: [
          "Held are deposits not yet returned; Returned are the ones that were.",
          "Search by name, phone, email, plate or note.",
          "Details shows the deposit and its booking.",
          "Mark returned… after the car is checked back in; part of it can be kept, with the reason written down.",
        ],
      },
      {
        heading: "Dynamic pricing",
        shot: "booking-dynamic",
        steps: [
          "Turn on dynamic pricing: it suggests a price for each car's unbooked days on your site, by season, weekday, lead time, fleet occupancy and holidays.",
          "Under Limits · Factors · Your own events · Cars, set how many days to price, the lowest and highest price (as a share of the daily rate), the factors, your own events (concerts, conventions) and which cars take part.",
          "Save settings.",
          "Then Compute suggestions to see the prices before applying them; tick apply every day to skip the confirmation.",
          "Remove dynamic prices takes every dynamic price off, back to your own.",
        ],
      },
      {
        heading: "Ads",
        shot: "booking-ads",
        steps: ["Pick a car to draft a listing for sites like Kijiji.", "Rewrite with AI to smooth the wording.", "Copy, then paste it into the ad site."],
      },
      {
        heading: "Rental website",
        shot: "booking-site",
        steps: [
          "Open site shows your website as it is now.",
          "Copy the site link to send to renters.",
          "Open the launch checklist to see what is not ready yet; Fix goes straight there.",
          "Switch the language tabs to edit the site's text in English, Simplified and Traditional Chinese.",
        ],
      },
      {
        heading: "Photos from Turo",
        shot: "booking-turo-photos",
        steps: ["Lists your cars' photos on Turo; Import to TATO puts them on the cars' pages on your site."],
      },
    ],
    tips: ["While the banner says Stripe payouts are not connected, renters cannot pay on the site. Connect under Payouts first."],
  },
  {
    key: "staff-schedule",
    title: "Staff Schedule",
    summary: "Hand deliveries, returns and cleaning to staff, who see and finish them from a link on their phone; pay them by the task.",
    sections: [
      {
        heading: "The board",
        shot: "staff-board",
        steps: [
          "Add staff adds someone; Archived staff finds people you stopped using.",
          "Upcoming deliveries / returns on the left lists handovers by day: drag a task onto a staff card, or pick someone under Choose staff.",
          "Copy link gives a staff member their own link, where they see their tasks on their phone.",
          "+ Subtask adds steps to a task, such as fuel or a wash.",
          "Complete when done. Tasks with nobody assigned wait under Unassigned.",
        ],
      },
      {
        heading: "Add staff",
        shot: "staff-add",
        steps: [
          "Enter the name, phone, email and role, and pick a colour (it marks their tasks); a standing reminder is added to every notification they get.",
          "Save. Their card appears on the board; then Copy link and send it to them.",
        ],
      },
      {
        heading: "Notification templates",
        shot: "staff-templates",
        steps: ["Set the email subject, email body and text message staff receive when a task is created, changed or deleted, with the variables listed below (name, task, time, car, link and more); save."],
      },
      {
        heading: "Staff pay",
        shot: "staff-pay",
        steps: [
          "In Staff pay, open a staff member and set the default price per task; save.",
          "Tasks lists the tasks they finished and what each earns.",
          "Payments records what you paid them.",
          "Reimbursements records what they paid for you, such as fuel.",
        ],
      },
    ],
  },
  {
    key: "contracts",
    title: "E-sign Contracts",
    summary: "Upload a contract template, place the fields to fill, and send it to the renter to sign online. This page is in Chinese for now, so its button names are quoted in Chinese.",
    sections: [
      {
        heading: "Send for signing",
        shot: "contracts-main",
        steps: [
          "「+ 创建合约模板」 (create template) uploads a new contract PDF.",
          "An existing template has 「编辑模板」 (edit), 「查看 PDF」 (view) and 「删除模板」 (delete).",
          "Under 「发送给租客签署」 choose the template in 「选择模板」; with 「绑定订单（可选）」 the renter, car and dates fill in by themselves.",
          "Enter the signer's name and email; 「+ 添加签署人」 adds another signer.",
          "「发送签约邮件」 sends it. Progress is under 「签约记录」 and signed PDFs under 「历史文档」.",
        ],
      },
      {
        heading: "Create a template",
        shot: "contracts-new",
        steps: [
          "Name the template, such as a short-term rental agreement.",
          "Choose the contract file (PDF).",
          "Set the default signers; 「+ 添加签署人」 adds one, and they can be moved up or down to set the signing order.",
          "「上传文件并创建模板」 uploads it, then place the fields and signature spots in the editor.",
        ],
      },
    ],
  },
  {
    key: "inspections",
    title: "Condition Photos",
    summary: "Walk-around photos at each handover: evidence of the car's condition that stands up in a Turo claim.",
    sections: [
      {
        heading: "Waiting for photos",
        shot: "inspections-main",
        steps: [
          "Waiting for photos lists coming handovers and returns with no photos yet, and how many hours remain.",
          "Window closed are the ones already missed.",
        ],
      },
      {
        heading: "Recent walk-arounds",
        shot: "inspections-recent",
        steps: ["Each row is one walk-around: car, time, photographer, photo count and completeness; Open shows all its photos. Under 100% means some angles were not taken."],
      },
      {
        heading: "One walk-around",
        shot: "inspections-session",
        steps: ["The photos by angle; Original file downloads the full-size picture with its time stamp, for a claim."],
      },
    ],
    tips: ["Photos are taken in the condition-photo phone app, which guides you angle by angle and stamps the time."],
  },
  {
    key: "photos",
    title: "Photos & Videos",
    summary: "Every photo and video uploaded to trips and cars, in one place: find them by car and download them together.",
    sections: [
      {
        heading: "Find and download",
        shot: "photos-main",
        steps: ["Pick a car under Vehicle.", "Search, or Filter by time.", "Download as ZIP downloads everything the filters show."],
      },
    ],
    tips: ["Photos are uploaded on a trip or a car; this page gathers them."],
  },
  {
    key: "documents",
    title: "Contract Files",
    summary: "Every contract and document uploaded to trips and cars, to find and download.",
    sections: [
      {
        heading: "Find and download",
        shot: "documents-main",
        steps: ["Pick a car under Vehicle, or search by file name.", "Open file to view it.", "Download as ZIP downloads them all."],
      },
    ],
    tips: ["Files are uploaded on a trip or a car; e-signed contracts appear here too."],
  },
  {
    key: "activity",
    title: "Activity log",
    summary: "Who changed what and when: every change to trips, cars, owners, notes and prices is recorded.",
    sections: [
      {
        heading: "Look something up",
        shot: "activity-main",
        steps: ["Filters narrows by person, kind or date.", "Each entry says what was done, by whom and when; open Metadata for the details of the change."],
      },
    ],
    tips: ["When numbers do not add up, start here: who changed a trip's amount, when it was synced to the owner."],
  },
  {
    key: "trash",
    title: "Trash",
    summary: "Deleted trips wait here and can be put back on the calendar.",
    sections: [
      {
        heading: "Restore trips",
        shot: "trash-main",
        steps: ["Restore on a trip puts it back on the calendar and in Orders.", "For several, tick them (or Select all) and press Restore on the bar at the bottom."],
      },
    ],
    tips: ["A deleted trip keeps its photos and files; they are all there after a restore."],
  },
  {
    key: "billing",
    title: "Buy Quota",
    summary: "Vehicle slots: the first five cars are free, and each one after that is paid monthly.",
    sections: [
      {
        heading: "Buy slots",
        shot: "billing-main",
        steps: [
          "The top shows your current vehicles, the free allowance, paid slots and how many you still need; enter the listing quantity to buy.",
          "Continue to Stripe to pay.",
          "With a coupon, enter it and press Apply coupon.",
        ],
      },
    ],
    tips: ["CSV imports stop while you are short of slots and continue once you have enough."],
  },
  {
    key: "payouts",
    title: "Payouts",
    summary: "Connect Stripe so a renter paying on your website pays straight into your account.",
    sections: [
      {
        heading: "Connect payouts",
        shot: "payouts-main",
        steps: ["Choose your country of operation: Canada or the United States.", "Start Stripe onboarding and finish identity and bank details on Stripe's pages; once approved, Status shows connected."],
      },
    ],
    tips: ["The platform fee is 5%, plus Stripe's card fee (about 2.9% + 30¢)."],
  },
  {
    key: "invoices",
    title: "Invoices & receipts",
    summary: "Charges outside Turo and your website: offline rentals, damage, a kept deposit.",
    sections: [
      {
        heading: "The list",
        shot: "invoices-list",
        steps: [
          "+ New invoice or + New receipt.",
          "Switch between All, Invoice and Receipt; the total still outstanding sits above.",
          "Email sends the invoice to the customer.",
          "Print / PDF prints it or saves a PDF.",
          "When the customer pays, Mark paid; one written by mistake can be voided or deleted.",
        ],
      },
      {
        heading: "Write an invoice",
        shot: "invoices-editor",
        steps: [
          "Choose the type and status, set the issue and due dates, and the recipient's name or company, email, phone and address.",
          "Under Items, enter each item, quantity, unit price and tax rate; totals add up by themselves.",
          "Add line adds another item; discount and amount paid sit at the bottom right.",
          "Save.",
        ],
      },
    ],
  },
  {
    key: "account-settings",
    title: "Account Settings",
    summary: "Company profile, login email and password, team members, language, appearance, the Turo reader and API tokens, and TATO on your phone.",
    sections: [
      {
        heading: "Company profile and login",
        shot: "settings-profile",
        steps: ["Change the company name and login display name; Save profile.", "Change the login email after your current password; Update email.", "Change the password (8 characters or more); Update password."],
      },
      {
        heading: "Team members",
        shot: "settings-team",
        steps: [
          "The account owner presses + Add a member to invite partners or staff, each with their own login; choose which pages each can open, limit them to some cars, or make them view-only.",
          "The owner split rules send three kinds of money, reimbursed costs, service income, and fines and damages, to the owner or to you; Save revenue split. Existing statements are not rewritten until you resync that owner.",
        ],
      },
      {
        heading: "Language, appearance and tools",
        shot: "settings-app",
        steps: [
          "Language: Auto, EN, 中文 or 繁中.",
          "Set up the reader configures the Turo reader, which reads your Turo data for you.",
          "Get an API token connects AI tools to TATO.",
          "Appearance: light, dark or match the phone. Below are the steps to add TATO to an iPhone home screen, and an APK to install on Android.",
        ],
      },
      {
        heading: "Turo reader and API tokens",
        shot: "settings-agent",
        steps: [
          "First 「签发新令牌」 (issue a token). It is shown once; if lost, issue another and revoke the old one.",
          "Drag 「读取 Turo 会话」 (read Turo conversations) to the bookmarks bar, or 「复制代码」 to paste it as a new bookmark. Click it on any Turo page to send the latest 25 conversations to TATO.",
          "API is for AI agents and scripts: 「签发只读令牌」 (read-only) reads trips, amounts, owner terms and ledgers; 「签发读写令牌」 (read-write) can also import Turo trips and write Turo conversations.",
        ],
      },
    ],
  },
];
