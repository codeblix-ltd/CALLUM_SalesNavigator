"use node";

import nodemailer from "nodemailer";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const send = internalAction({
  args: { id: v.id("bugReports"), clientId: v.optional(v.string()), attempt: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const details = await ctx.runQuery(internal.bugReports.notificationDetails, args);
    if (!details) return;
    const password = process.env.BUG_REPORT_SMTP_PASSWORD;
    if (!password) throw new Error("Bug report SMTP password is not configured.");
    const sender = "smtp@codeblix.com";
    const transporter = nodemailer.createTransport({
      host: "smtp.hostinger.com", port: 465, secure: true,
      auth: { user: sender, pass: password },
      connectionTimeout: 10000, socketTimeout: 15000,
    });
    try {
      await transporter.sendMail({
        from: sender, to: "antishchoolun95@gmail.com",
        subject: `[Callum Scout] New bug ${details.kind} from ${details.reporter.slice(0, 80)}`,
        text: `New ${details.kind} from ${details.reporter}\nReport ID: ${details.reportId}\n\n${details.text}\n\nScreenshots attached in the private support inbox: ${details.screenshotCount}.`,
      });
    } catch (error) {
      const attempt = args.attempt ?? 0;
      if (attempt < 3) await ctx.scheduler.runAfter(60_000 * 2 ** attempt, internal.bugReportEmail.send, { ...args, attempt: attempt + 1 });
      throw error;
    }
  },
});
