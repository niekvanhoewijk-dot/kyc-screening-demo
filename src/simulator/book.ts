import fs from "node:fs";
import path from "node:path";
import { simCustomers } from "@/db/schema";
import { bookCustomerSchema, parseBook, type Book, type BookCustomer } from "@/engine";
import type { PortalDeps } from "@/portal/deps";

// The synthetic book (spec 08 section 5.2): the fixture as shipped, overlaid by customers whose facts an
// injected event changed. The demo reset empties the overlay.

let fixture: Book | undefined;

export function bookFixture(file = path.resolve(/* turbopackIgnore: true */ process.cwd(), "fixtures/portfolio/book.json")): Book {
  fixture ??= parseBook(JSON.parse(fs.readFileSync(file, "utf8")));
  return fixture;
}

export function bookCustomers(deps: Pick<PortalDeps, "db">): BookCustomer[] {
  const changed = new Map(deps.db.select().from(simCustomers).all().map((r) => [r.id, bookCustomerSchema.parse(r.customer)]));
  return bookFixture().customers.map((c) => changed.get(c.id) ?? c);
}

export function bookCustomer(deps: Pick<PortalDeps, "db">, id: string): BookCustomer | undefined {
  return bookCustomers(deps).find((c) => c.id === id);
}

export function saveBookCustomer(deps: Pick<PortalDeps, "db" | "now">, customer: BookCustomer) {
  const updatedAt = deps.now().toISOString();
  deps.db.insert(simCustomers).values({ id: customer.id, customer, updatedAt }).onConflictDoUpdate({ target: simCustomers.id, set: { customer, updatedAt } }).run();
}

/** Engine facts for a decision record: the free-text note stays out (spec 08 4.2). */
export const recordFacts = ({ note: _note, ...facts }: BookCustomer): BookCustomer => facts;
