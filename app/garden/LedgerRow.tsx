import Link from "next/link";
import { tasteLine, type LedgerPerson } from "@/agent/lib/garden/ledger";
import { formatTimelineDate } from "@/agent/lib/ideas/timeline-format";
import { Icon } from "./cards/icons";

/** One person in the taste ledger: first name, what became of their tips, and their latest one. The row is the link. */
export function LedgerRow({ person }: { person: LedgerPerson }) {
  return (
    <li className="ledger-row" data-testid="ledger-row" data-last-tip={person.lastTipAt}>
      <Link href={`/people/${person.id}`} className="ledger-link">
        <span className="ledger-text">
          <span className="ledger-name">{person.firstName}</span>
          <span className="ledger-taste">{tasteLine(person)}</span>
          <span className="ledger-latest">
            Latest: <span className="ledger-latest-name">{person.latest}</span> · {formatTimelineDate(new Date(person.lastTipAt))}
          </span>
        </span>
        <Icon name="chevron" size={18} className="ledger-chev" />
      </Link>
    </li>
  );
}

/** Tips with no name attached. Not a person, so not a link: a quiet count at the end of the list. */
export function UnknownRow({ count }: { count: number }) {
  return (
    <li className="ledger-row ledger-row--unknown" data-testid="ledger-unknown">
      <span className="ledger-text">
        <span className="ledger-name">From someone, not sure who</span>
        <span className="ledger-taste">{count} {count === 1 ? "tip" : "tips"}</span>
      </span>
    </li>
  );
}
