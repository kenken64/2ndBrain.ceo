# Chat attachment test data

The sample records and events in these examples are fictional. The PowerPoint design template includes existing AICUBER branding. Each example below includes the files to attach, a prompt or action, and results to check.

1. Open **AI Chat** and start a new conversation.
2. Attach the files listed for the test, or choose the indicated chat mode.
3. Follow the test's prompt or action. Review the answer and any field mapping.
4. Open **My files** to download saved uploads and generated outputs. For tests that use AI, check **AI Credits Usage** for the processing cost.

The batch tests use the first spreadsheet row as headers and generate one file for each subsequent record. For individual file questions, attach one file. AI output can vary, so compare the facts and generated files with the expected results rather than requiring exact wording.

## Test 1: Excel to fillable PDF

Files: [participants.xlsx](test-1/participants.xlsx) and [registration-form.pdf](test-1/registration-form.pdf)

Prompt: **Fill the PDF form using each row in the Excel file and generate one completed PDF per participant.**

Expected: Five completed PDFs. For example, Alice Tan's form should include `alice.tan@example.com`, `Northstar Labs`, `AI for Business`, and `2026-11-05`. The response should show how the spreadsheet columns were mapped to the PDF fields.

## Test 2: Excel to Word template

Files: [participants.xlsx](test-2/participants.xlsx) and [registration-confirmation-template.docx](test-2/registration-confirmation-template.docx)

Prompt: **Fill the Word template using each row in the Excel file and generate one document per participant.**

Expected: Five editable Word documents, each with all matching placeholders replaced. Alice Tan's document should include `alice.tan@example.com`, `Northstar Labs`, `AI for Business`, and `2026-11-05`.

## Test 3: Image description

File: [kitchen-cat.png](test-3/kitchen-cat.png)

Prompt: **Describe this image, including the objects, setting, and lighting.**

Expected: A ginger cat beside a wooden table in a sunlit kitchen, with a mug, notebook, pencil, oranges, and plants.

## Test 4: Spreadsheet analysis

File: [sales-records.xlsx](test-4/sales-records.xlsx)

Prompt: **How many orders are there, what is total revenue, and how much revenue came from each region and product?**

Expected: Six orders and USD 6,000 total. Singapore: USD 3,600; Malaysia: USD 2,400. Basic: USD 3,300; Premium: USD 2,700.

Alternative prompt, with the spreadsheet attached: **What was the total revenue in January, February, and March, and which month was highest?**

Expected: January USD 2,000; February USD 2,100; March USD 1,900. February was highest.

## Test 5: Image OCR

File: [receipt.png](test-5/receipt.png)

Prompt: **Extract the receipt text and list the items, subtotal, tax, and total.**

Expected: Receipt `HB-2048`; subtotal `$28.00`; tax `$2.52`; total `$30.52`. The three items are notebooks, a pen set, and a canvas bag. Check the extracted-text side panel as well as the answer.

## Test 6: Scanned PDF OCR and summary

File: [scanned-meeting-notes.pdf](test-6/scanned-meeting-notes.pdf)

Prompt: **Extract and summarize the meeting notes. List the decision, budget, action owners, and deadlines.**

Expected: A pilot on 1 December 2026 with a USD 8,000 budget. Maya will finalize the pilot plan by 18 November, Alex will prepare the customer list by 20 November, and Priya will test the reporting dashboard by 25 November. The next meeting is on 26 November at 10:00 AM. This is an image-only PDF made to simulate a scan.

## Test 7: Word document questions

File: [support-plan.docx](test-7/support-plan.docx)

Prompt: **Summarize the plan. What is the response-time target, who owns the pilot, and what is the main risk?**

Expected: The pilot is owned by Maya Chen, aims to reduce average first response time from 24 to 8 hours, and faces the risk of limited weekend coverage.

Alternative prompt, with the Word file attached: **When does the pilot start, how long does it run, and when will the team review staffing?**

Expected: The pilot starts on 2 November 2026, runs for four weeks, and the staffing review is on 16 November 2026.

## Test 8: Excel to PowerPoint template

Files: [participants.xlsx](test-8/participants.xlsx) and [training-template.pptx](test-8/training-template.pptx)

Prompt: **Fill the PowerPoint template using each spreadsheet row and create one presentation per participant.**

Expected: Five editable PPTX files, with names and other fields filled on both slides. For Alice Tan, verify `Northstar Labs`, `alice.tan@example.com`, `AI for Business`, and `2026-11-05`. The template uses simple `{{Field Name}}` placeholders. Download a file and open it in PowerPoint to inspect the slide layout.

## Test 9: PowerPoint from a prompt

Choose **Generate PowerPoint** in chat. No attachment is required.

Prompt: **Create a five-slide presentation explaining a four-week pilot to improve customer support response times. Cover the goal, timeline, team responsibilities, and risks.**

Expected: An editable presentation with a cover and concise content slides, saved to My files. Download it to review the layout. The AI may choose wording and details; check facts before sharing.

## Test 10: Apply a new PowerPoint design

Attach [source-content.pptx](test-10/source-content.pptx) first and [design-template.pptx](test-10/design-template.pptx) second. The chat will label them **Content** and **Template**; use **Swap content and template** if necessary. Send the request with the arrow button; no prompt is needed and this transfer uses no AI credits.

Expected: One editable presentation saved in My files, with the AICUBER template design and the source slide's “Sales and receipt” title, receipt image, and bar chart (A = 20, B = 35). Download and open it in PowerPoint to check that the image and chart are present and the chart data remains editable. The chart overlays the template watermark, illustrating why every result needs a layout review. Source object positions are retained; speaker notes, animations and transitions are not transferred.
