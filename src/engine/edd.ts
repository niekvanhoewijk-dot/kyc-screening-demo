import type { EngineConfig } from "./config";
import { sofPercent } from "./factors";
import { floorDollars } from "./money";

export type EddInput = {
  source_of_funds: string;
  only_source_of_wealth?: boolean;
  /** Annual amount evidenced by the SoF documents; null = client unable or unwilling to provide. */
  documented_annual_amount: number | null;
  deposited_to_date: number;
};

export type EddResult =
  | { outcome: "new_threshold"; new_threshold: number; headroom: number }
  | { outcome: "return_excess_and_block"; excess_to_return: number; report_to: ["aml", "compliance"] }
  | { outcome: "return_all_and_terminate"; amount_to_return: number; report_to: ["aml", "compliance"] };

/** EDD trigger 2 (docs/spec/05): deposits reach or exceed the current threshold. */
export function depositTriggersEdd(depositedToDate: number, threshold: number): boolean {
  return depositedToDate >= threshold;
}

/**
 * EDD recalculation (docs/spec/05). The initial hard ceiling does not apply here (O-2).
 * The demo moves no money: "return" outcomes become analyst-recorded instructions.
 */
export function recalculateEdd(input: EddInput, config: EngineConfig): EddResult {
  const deposited = input.deposited_to_date;
  if (input.documented_annual_amount === null)
    return { outcome: "return_all_and_terminate", amount_to_return: deposited, report_to: ["aml", "compliance"] };

  const pct = sofPercent(input.source_of_funds, input.only_source_of_wealth ?? false, config);
  const covered = floorDollars(pct * input.documented_annual_amount);

  // O-12: equality is undefined in the doc; spec 05 default = new threshold, zero headroom.
  if (covered >= deposited) return { outcome: "new_threshold", new_threshold: covered, headroom: covered - deposited };
  return { outcome: "return_excess_and_block", excess_to_return: deposited - covered, report_to: ["aml", "compliance"] };
}
