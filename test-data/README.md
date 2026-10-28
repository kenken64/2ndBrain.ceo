# Chat attachment test data

All names, businesses, records, and events in these examples are fictional. Attach the listed files in AI Chat and use the sample prompt. Uploaded and generated files appear in My files. AI processing consumes credits.

## Test 1: Excel to fillable PDF

Files: `test-1/participants.xlsx` and `test-1/registration-form.pdf`

Prompt: **Fill the PDF form using each row in the Excel file and generate one completed PDF per participant.**

Expected: Five completed PDFs. For example, Alice Tan's form should include `alice.tan@example.com`, `Northstar Labs`, `AI for Business`, and `2026-11-05`.

## Test 2: Excel to Word template

Files: `test-2/participants.xlsx` and `test-2/registration-confirmation-template.docx`

Prompt: **Fill the Word template using each row in the Excel file and generate one document per participant.**

Expected: Five editable Word documents, each with all matching placeholders replaced. Alice Tan's document should include her email, company, course, and session date.

## Test 3: Image description

File: `test-3/kitchen-cat.png`

Prompt: **Describe this image, including the objects, setting, and lighting.**

Expected: A ginger cat beside a wooden table in a sunlit kitchen, with a mug, notebook, pencil, oranges, and plants.

## Test 4: Spreadsheet analysis

File: `test-4/sales-records.xlsx`

Prompt: **How many orders are there, what is total revenue, and how much revenue came from each region and product?**

Expected: Six orders and USD 6,000 total. Singapore: USD 3,600; Malaysia: USD 2,400. Basic: USD 3,300; Premium: USD 2,700.

## Test 5: Image OCR

File: `test-5/receipt.png`

Prompt: **Extract the receipt text and list the items, subtotal, tax, and total.**

Expected: Receipt `HB-2048`; subtotal `$28.00`; tax `$2.52`; total `$30.52`. The three items are notebooks, a pen set, and a canvas bag. Check the extracted-text side panel as well as the answer.

## Test 6: Scanned PDF OCR and summary

File: `test-6/scanned-meeting-notes.pdf`

Prompt: **Extract and summarize the meeting notes. List the decision, budget, action owners, and deadlines.**

Expected: A pilot on 1 December 2026 with an USD 8,000 budget. Maya's deadline is 18 November, Alex's is 20 November, and Priya's is 25 November. This is an image-only PDF made to simulate a scan.

## Test 7: Word document questions

File: `test-7/support-plan.docx`

Prompt: **Summarize the plan. What is the response-time target, who owns the pilot, and what is the main risk?**

Expected: The pilot is owned by Maya Chen, aims to reduce average first response time from 24 to 8 hours, and faces the risk of limited weekend coverage.

## Test 8: Excel to PowerPoint template

Files: `test-8/participants.xlsx` and `test-8/training-template.pptx`

Prompt: **Fill the PowerPoint template using each spreadsheet row and create one presentation per participant.**

Expected: Five editable PPTX files, with names and other fields filled on both slides. For Alice Tan, verify the company, email, course and session date. The template uses simple `{{Field Name}}` placeholders.

## Test 9: PowerPoint from a prompt

Choose **Generate PowerPoint** in chat. No attachment is required.

Prompt: **Create a five-slide presentation explaining a four-week pilot to improve customer support response times. Cover the goal, timeline, team responsibilities, and risks.**

Expected: An editable presentation with a cover and concise content slides, saved to My files. The AI may choose wording and details; review the slides before sharing.
