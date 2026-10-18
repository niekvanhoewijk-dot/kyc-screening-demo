export type Mail = { to: string; subject: string; text: string };

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

/** Demo mailer: prints to the server console instead of sending (spec 01, 2.1.2). */
export class ConsoleMailer implements Mailer {
  async send(mail: Mail): Promise<void> {
    console.log(`\n[mock mailer] to=${mail.to} subject="${mail.subject}"\n${mail.text}\n`);
  }
}

/** Test mailer: keeps messages in memory. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}
