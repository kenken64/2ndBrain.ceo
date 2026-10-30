# Chat attachment test data

The sample records and events in these examples are fictional. The PowerPoint design template includes existing AICUBER branding. Each example below includes the files to attach, a prompt or action, and results to check.

1. Open **AI Chat** and start a new conversation.
2. Attach the files listed for the test, or choose the indicated chat mode.
3. Follow the test's prompt or action. Review the answer and any field mapping.
4. Open **My files** to download saved uploads and generated outputs. For tests that use AI, check **AI Credits Usage** for the processing cost.

The batch tests use the first spreadsheet row as headers and generate one file for each subsequent record. For individual file questions, attach one file. AI output can vary, so compare the facts and generated files with the expected results rather than requiring exact wording.

## Test 1: Excel to fillable PDF

Files: [participants.xlsx](test-1/participants.xlsx) and [registration-form.pdf](test-1/registration-form.pdf)

Action: Select **Review fields**, check the proposed mappings and select **Generate documents**.

Expected: Five completed PDFs. For example, Alice Tan's form should include `alice.tan@example.com`, `Northstar Labs`, `AI for Business`, and `2026-11-05`. The response should show how the spreadsheet columns were mapped to the PDF fields.

## Test 2: Excel to Word template

Files: [participants.xlsx](test-2/participants.xlsx) and [registration-confirmation-template.docx](test-2/registration-confirmation-template.docx)

Action: Select **Review fields**, check the proposed mappings and select **Generate documents**.

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

Action: Select **Review fields**, check the proposed mappings and select **Generate documents**.

Expected: Five editable PPTX files, with names and other fields filled on both slides. For Alice Tan, verify `Northstar Labs`, `alice.tan@example.com`, `AI for Business`, and `2026-11-05`. The template uses simple `{{Field Name}}` placeholders. Download a file and open it in PowerPoint to inspect the slide layout.

## Test 9: PowerPoint from a prompt

Select **PowerPoint** above the chat message box. No attachment is required.

Prompt: **Create a five-slide presentation explaining a four-week pilot to improve customer support response times. Cover the goal, timeline, team responsibilities, and risks.**

Expected: An editable presentation with a cover and concise content slides, saved to My files. Download it to review the layout. The AI may choose wording and details; check facts before sharing.

## Test 10: Apply a new PowerPoint design

Attach [source-content.pptx](test-10/source-content.pptx) first and [design-template.pptx](test-10/design-template.pptx) second. Check the **Content to copy** and **New design template** labels, use **Swap content and template** if necessary, then confirm the roles and select **Apply template**. No prompt is needed and this transfer uses no AI credits.

Expected: One editable presentation saved in My files, with the AICUBER logo and the source slide's “Sales and receipt” title, receipt image, and bar chart (A = 20, B = 35). The title, receipt, chart and template logo should be separate. Download and open it in PowerPoint to check that the chart data remains editable. The transfer chooses a clear template layout and scales or repositions source objects together; speaker notes, animations and transitions are not transferred.

## Test 11: Mapping review, batch results and file reuse

Files: [attendees-mapping.csv](test-11/attendees-mapping.csv), [registration-form.pdf](test-11/registration-form.pdf), [registration-template.docx](test-11/registration-template.docx) and [presentation-template.pptx](test-11/presentation-template.pptx). All sample records are fictional.

1. **Drag and drop:** Drop the CSV and PDF into the chat composer. The two files should attach and appear in the preview panel.
2. **Mapping review:** Select **Review fields**. Choose `Attendee` for `Full Name`, `Email Address` for `Email`, and `Organization` for `Company`; check that `Course` and `Session Date` match. Select **Generate documents**. No AI credits are charged for this mapping or batch.
3. **Progress and ZIP:** The batch should process three records. Rows 2 and 4 should succeed; row 3 should report that its email exceeds the PDF field's 100-character limit. Select **Download all as ZIP** and confirm it contains the two successful PDFs. The files are also saved in My files.
4. **Word preview and mapping:** Attach the CSV and DOCX template in a new chat. The side panel should show a formatted document with a table and receipt image. Review and correct the same three mappings before generating. All three Word files should be created; the Word template does not impose the PDF's email length limit.
5. **Follow-up:** In the completed PDF batch, select **Ask about** on the row 2 PDF. Ask **What name, company and course are on this form?** Expected: Alice Tan, Northstar Labs and AI for Business. The file is processed again, so normal AI and PDF OCR charges apply.
6. **PowerPoint preview and questions:** Attach the presentation template by itself and ask **What registration details appear on these slides?** After the response, select **Ask about** on the presentation and ask **What placeholders are listed?** Use the side panel's **Next** and **Previous** buttons to inspect both slides. Answers use slide text; images and charts are not sent for analysis. Visual rendering is an approximation; download the original for a definitive layout check. For a chart and image example, also preview [the Test 10 source deck](test-10/source-content.pptx).

## Test 12: Image and video mode controls

1. With no files attached, select **Image** above the message box. Copy [image-prompt.txt](test-12/image-prompt.txt) into the composer and select **Create image**. Check that an image is returned and saved in My files.
2. Select **Video · 15s**, copy [video-prompt.txt](test-12/video-prompt.txt) and select **Create video**. Check the progress message and the saved 15-second video when the job completes.
3. Select **Chat** to return to ordinary questions. Attach a file and confirm the mode buttons cannot be changed until the attachment is removed.

Image and video generation use AI credits. Review the displayed estimate and AI Credits Usage; provider availability and final costs can vary.

## Test 13: PowerPoint generation and recovery

The [prompt](test-13/prompt.txt) is the five-slide customer support pilot example from Test 9. [sample-slide-content.json](test-13/sample-slide-content.json) is a fictional, offline AI-response fixture with extra and long bullets.

Run `node --test tests/chat-pptx.test.cjs tests/chat-pptx-recovery.test.cjs tests/chat-api.test.cjs`. The tests render the fixture into an editable PowerPoint, continue the extra content onto another slide, and simulate a storage failure and a no-charge save retry. They do not call OpenRouter or charge AI credits. If you run the prompt manually in chat, the AI request is billable.

## Test 14: Prevent overlapping PowerPoint objects

Attach [overlapping-source.pptx](test-14/overlapping-source.pptx) as **Content to copy** and [design-template.pptx](test-10/design-template.pptx) as **New design template**. Confirm the roles and select **Apply template**.

Expected: The app reports that source objects overlap or are too close and does not save a misleading result. The image was deliberately positioned over the title for this test. Repeat with [source-content.pptx](test-10/source-content.pptx) to verify the clean transfer in Test 10. Reversing the two roles and attempting to proceed should also be rejected when the template cannot be checked safely. Neither transfer uses AI credits.

For comparison, [expected-restyled.pptx](test-14/expected-restyled.pptx) is the result of the corrected Test 10 transfer. Check that its title, receipt, chart and AICUBER logo do not overlap; the chart remains editable.

## Test 15: Streaming a long chat response and stopping it

Choose **Chat** with no attachment. Use [the long-response prompt](test-15/prompt.txt), then select **Send**. Text should appear as it is generated, and **Send** should change to **Stop**. Select **Stop** while the answer is arriving; the partial answer should remain in the conversation, and you should be able to send another message. Repeat without stopping and check that the full response appears. The output limit is higher, but exact essay length depends on the model.

Manual requests use AI credits; stopping does not guarantee the provider stops billing. Check **AI Credits Usage** for the status. [provider-stream.sse](test-15/provider-stream.sse) contains fictional usage for offline tests only. Run `node --test tests/chat-stream.test.cjs tests/chat-api.test.cjs` to test streaming and accounting without calling OpenRouter.

## Test 16: Response statistics and copying

Use [the benchmark fixture](test-16/benchmark-response.json) for the offline test: `node --test tests/chat-response-metrics.test.cjs tests/chat-stream.test.cjs tests/chat-api.test.cjs`. The fixture has nine words, a 2.5-second response time, 30 provider-reported output tokens, and a 2-second AI request, giving 15 tokens/s.

For a manual check, send [the long-response prompt](test-15/prompt.txt) in Chat. After the response finishes, check its word count, response time, output tokens, and tokens/s. Select the copy icon and paste into a text editor to check the copied message. Reopen the chat and confirm the statistics remain. Older responses and requests without provider token counts show a dash for unavailable measurements. The displayed response time includes the app's processing; tokens/s divides the provider's output tokens by the AI request duration, including provider latency. Stops may not return token counts. Batch or media workflows may not report text-token statistics. Manual AI requests use credits.

## Test 17: Knowledge graph workspace sizing

[knowledge-graph.json](test-17/knowledge-graph.json) is a small fictional graph with a customer, meeting notes, decision, and topic for a layout preview. Open an existing Nth Brain graph on a wide desktop display. The node map should use the available width beside the sidebar and fit within the visible height. Collapse and expand the sidebar, switch between **3D galaxy** and **2D map**, and use **Fit** or full screen. The graph should resize without covering its controls. On a phone, the map and controls should remain usable with page scrolling. The graph does not use AI credits.

## Test 18: Ingest a PDF into Nth Brain and build a knowledge graph

Files: [nth-brain-support-pilot.pdf](test-18/nth-brain-support-pilot.pdf) and [ingestion-prompt.txt](test-18/ingestion-prompt.txt). This is a searchable, three-page fictional project brief with people, a company, a team, tools, a target, a decision, a risk, and feedback. The double-bracketed names identify linked concepts.

1. Open a ready **Nth Brain** project. For a clean test, use a separate test project so these fictional pages do not mix with real project knowledge.
2. Under **Upload to this Nth Brain**, select **Attach documents** and choose the PDF. Paste the prompt below into **Instruction for AI ingestion** and select **Upload into Nth Brain**.
3. Wait for the background ingest to finish and the page tree to refresh. Inspect the generated pages and their `[[wiki links]]`. If pages are missing, paste the instruction again and select **Retry saved upload**. If the source was not saved, attach the PDF again. Resolve any displayed error before continuing.
4. Select **Generate knowledge graph**, wait for indexing to finish, then open **Knowledge Graph** for the same project. Use search to find **Support Pilot**, **Maya Chen**, **Ticket Routing**, and **Knowledge Base**. Select nodes to inspect their connections and open their source pages.
5. Check that the pages preserve at least these relationships: Maya owns Support Pilot; Alex owns Ticket Routing; Ticket Routing depends on Knowledge Base; Priya owns Response Time Dashboard; and Weekend Coverage is a risk to the Eight-Hour Target. The exact number, labels, types, and edges can vary with AI ingestion. Graph links are derived from indexed wiki links and supported relation fields; a line does not by itself prove the relationship is correct. Project-scope visual links may also appear.

**Instruction for AI ingestion:**

```text
Ingest the attached fictional Northstar Labs support-pilot brief into this Nth Brain. Use the PDF as the source of truth and preserve its names, dates, ownership, decisions, risks, and stated relationships. Do not invent facts.

Create or update separate, clearly titled wiki pages for Northstar Labs, Customer Support Team, Support Pilot, Maya Chen, Alex Tan, Priya Rao, Sam Lee, Ticket Routing, Knowledge Base, Response Time Dashboard, Eight-Hour Target, Pilot Approval, Weekend Coverage, and Customer Feedback. Link related pages using exact wiki links such as [[Support Pilot]], [[Maya Chen]], and [[Ticket Routing]] so the knowledge graph can index the connections. Include the source document and useful links in the Nth Brain index and log.

For relationships supported by the document, use the graph's supported relation names in page frontmatter where appropriate: owned_by, depends_on, related_to, decision_from, or source_for. For example, on the Support Pilot page use owned_by: Maya Chen; on the Ticket Routing page use owned_by: Alex Tan and depends_on: Knowledge Base. Describe the evidence in each page as well. Do not turn a risk, target, or proposed outcome into a fact that has already occurred.
```

Ingestion uses the project's AI agent and may incur its normal costs. Generating the graph indexes the resulting wiki content. The PDF is text-based, so it does not require OCR.

## Test 19: Send button direction

Open **AI Chat** and enter [the sample prompt](test-19/prompt.txt). The arrow beside **Send** should point right and the button should be enabled. Check the intent prompt composer on the Nth Brain page as well: its send arrow should point right. Sending an AI request may incur normal charges; inspecting the icons does not.

## Test 20: Play a generated MP4 in My files

For a manual test, select **Video · 15s** in AI Chat and use [video-prompt.txt](test-20/video-prompt.txt). Once the video job finishes, open **My files** and select **Play** next to the generated MP4. The video should play in the browser with controls; pause it, seek to another point, close the player, and confirm My files remains open. Use **Download** to save the original video. Repeat on desktop and mobile. Creating the video uses AI credits; playing an existing video does not.

[playback-sample.mp4](test-20/playback-sample.mp4) is a three-second fictional test pattern for offline playback testing; it is not an AI-generated output and cannot be uploaded as a chat attachment. Run `node --test tests/chat-files.test.cjs` to verify authenticated video preview and byte-range responses without generating a video.

## Test 21: Generate a 15-second video and track its cost

Select **Video · 15s** in AI Chat and use [video-prompt.txt](test-21/video-prompt.txt). Before submitting, confirm the app displays the current estimated reservation. Select **Create video**, wait for the job to finish, then open **My files** to play and download the saved MP4. Check its duration in the player and review the itemized charge in **AI Credits Usage**. The estimate and final charge can differ. An AI video request is billable and generated output is subject to the 20 MiB storage limit.

For an offline check, run `node --test tests/chat-video-generation.test.cjs`. It verifies the 15-second provider request, model capability check, reservation, final-cost settlement, and job recovery without generating a video.

## Test 22: Ingest a community garden PDF and build a knowledge graph

Files: [nth-brain-community-garden.pdf](test-22/nth-brain-community-garden.pdf) and [ingestion-prompt.txt](test-22/ingestion-prompt.txt). This searchable, three-page fictional brief provides a second topic for the Test 18 ingestion and graph workflow.

1. Open a ready **Nth Brain** project, preferably a separate test project so the fictional pages do not mix with real knowledge.
2. Under **Upload to this Nth Brain**, attach the PDF, paste the contents of the prompt file into **Instruction for AI ingestion**, and select **Upload into Nth Brain**.
3. Wait for ingestion to finish. Inspect the generated pages and their `[[wiki links]]`, then select **Generate knowledge graph** and open **Knowledge Graph** for the same project.
4. Search for **Rainwater Harvesting Project**, **Nadia Lim**, **Rain Barrel System**, and **Water Usage Log**. Open the nodes and their source pages to check the evidence.
5. Verify that Nadia owns the project; Omar owns the Rain Barrel System; the system's installation depends on Gutter Inspection; Lena owns Water Usage Log; and Dry Weather Risk may threaten the Water Savings Target. The target is proposed, not an achieved outcome. Graph labels, types, and edge counts can vary with AI ingestion, so check the pages as well as the graph.

Ingestion uses the project's AI agent and may incur its normal costs. Graph generation indexes the resulting wiki content. The PDF is text-based and does not require OCR.
