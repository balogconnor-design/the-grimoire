import { useMemo, useState, type ReactNode } from 'react';
import type { Card } from '../types';
import { Modal } from './Modal';
import { TagEditor, TagLegend, SCOPE_META, type TagScope } from './TagEditor';
import { useToast } from './Toast';
import { collectionT, decksT } from '../lib/store';
import { addCard, cardTagSuggestions, setCardTagsInDeck, setDeckTags } from '../lib/actions';
import { addItems, setCollectionTagsForCard, updateItem } from '../lib/collection';
import { useAllCardTags, useAllCollectionTags, useAllDeckTags, useLotsFor } from '../lib/hooks';
import { cardImage } from '../lib/rules';

/** Where the tag panel was opened from — decides which scope leads and what's suggested. */
export type TagContext =
  | { kind: 'deck'; deckId: string } // deck list or a deck's Scryfall search
  | { kind: 'collection'; itemId?: string } // inventory row (a specific lot) or collection views
  | { kind: 'search' }; // main-page Scryfall search

interface Props {
  card: Card;
  context: TagContext;
  onClose: () => void;
}

export function TagModal({ card, context, onClose }: Props) {
  const decks = decksT.useAll();
  const lots = useLotsFor(card);
  const item = collectionT.useOne(context.kind === 'collection' ? context.itemId : undefined);
  const allCollectionTags = useAllCollectionTags();
  const allCardTags = useAllCardTags();
  const allDeckTags = useAllDeckTags();
  const toast = useToast();

  const deckOptions = useMemo(() => {
    const has = (id: string) => !!decks.find((d) => d.id === id)?.entries.some((e) => e.card.name === card.name);
    return [...decks].sort((a, b) => Number(has(b.id)) - Number(has(a.id)) || b.updatedAt - a.updatedAt).map((d) => ({ deck: d, has: has(d.id) }));
  }, [decks, card.name]);

  const lockedDeckId = context.kind === 'deck' ? context.deckId : undefined;
  const [pickDeck, setPickDeck] = useState(false);
  const [selDeck, setSelDeck] = useState<string>(() => lockedDeckId ?? deckOptions.find((o) => o.has)?.deck.id ?? deckOptions[0]?.deck.id ?? '');
  const deck = decks.find((d) => d.id === selDeck);
  const entries = deck?.entries.filter((e) => e.card.name === card.name) ?? [];
  const cardTags = [...new Set(entries.flatMap((e) => e.tags ?? []))];
  const sugg = deck ? cardTagSuggestions(deck.id, card.name, decks) : { fromOtherDecks: [], inThisDeck: [] };

  // Lead scope by context.
  const lead: TagScope = context.kind === 'deck' ? 'card'
    : context.kind === 'collection' ? 'collection'
      : lots.length ? 'collection' : 'card';

  // ----- Collection section: one lot (from an inventory row) or every copy -----
  const allLotTags = [...new Set(lots.flatMap((i) => i.tags))];
  const otherLotTags = [...new Set(lots.filter((i) => i.id !== item?.id).flatMap((i) => i.tags))];
  const lotScoped = !!item;
  const collectionTags = lotScoped ? item!.tags : allLotTags;
  const onCollectionChange = (next: string[]) => {
    if (lotScoped) {
      updateItem(item!.id, (d) => { d.tags = next; });
      return;
    }
    const add = next.filter((t) => !collectionTags.includes(t));
    const remove = collectionTags.filter((t) => !next.includes(t));
    void setCollectionTagsForCard(card.name, add, remove);
  };
  const missingOnOtherLots = lotScoped && lots.length > 1 && item!.tags.some((t) => lots.some((l) => !l.tags.includes(t)));

  const deckSection = (
    <Section key="deck" title={deck ? deck.name : 'Deck'} lead={lead === 'card'}
      aside={
        lockedDeckId && !pickDeck ? (
          decks.length > 1 && <button className="link-btn small" onClick={() => setPickDeck(true)}>Tag in another deck</button>
        ) : decks.length > 0 ? (
          <select className="input input-sm" value={selDeck} onChange={(e) => setSelDeck(e.target.value)} aria-label="Deck to tag">
            {deckOptions.map(({ deck: d, has }) => <option key={d.id} value={d.id}>{d.name}{has ? ' · has this card' : ''}</option>)}
          </select>
        ) : <span className="muted small">No decks yet</span>
      }
    >
      {deck && (
        <>
          <div className="label">{SCOPE_META.card.icon} Card tags — only in this deck</div>
          {entries.length ? (
            <TagEditor
              scope="card" tags={cardTags} onChange={(t) => setCardTagsInDeck(deck.id, card.name, t)}
              placeholder="e.g. ramp, wincon, removal" autoFocus={lead === 'card'}
              suggestions={[
                { label: 'This card in your other decks', tags: sugg.fromOtherDecks },
                { label: 'Used in this deck', tags: sugg.inThisDeck },
                { label: 'Other card tags', tags: allCardTags.slice(0, 10) },
              ]}
            />
          ) : (
            <div className="tag-empty">
              <span className="muted small">Not in this deck — card tags belong to a card inside a deck.</span>
              <button className="btn btn-sm" onClick={() => toast(addCard(deck.id, card), 'success')}>+ Add to deck</button>
            </div>
          )}
          <div className="label tag-gap">{SCOPE_META.deck.icon} Deck tags — on “{deck.name}” itself</div>
          <TagEditor
            scope="deck" tags={deck.tags ?? []} onChange={(t) => setDeckTags(deck.id, t)} placeholder="e.g. cedh, budget, tribal"
            suggestions={[{ label: 'Your deck tags', tags: allDeckTags }]}
          />
        </>
      )}
    </Section>
  );

  const collectionSection = (
    <Section key="collection" title="Collection" lead={lead === 'collection'}
      aside={<span className="muted small">{lots.length ? `${lots.reduce((n, i) => n + i.qty, 0)} owned · ${lots.length} lot${lots.length === 1 ? '' : 's'}` : 'Not owned'}</span>}
    >
      <div className="label">
        {SCOPE_META.collection.icon} Collection tags — {lotScoped ? `this lot (${item!.card.set.toUpperCase()} #${item!.card.collector_number}, ${item!.qty}×)` : 'every copy you own'}
      </div>
      {lots.length ? (
        <>
          <TagEditor
            scope="collection" tags={collectionTags} onChange={onCollectionChange}
            placeholder="e.g. binder, trade bait, signed" autoFocus={lead === 'collection'}
            suggestions={[
              { label: lotScoped ? 'On your other copies' : 'Used on this card', tags: lotScoped ? otherLotTags : allLotTags },
              { label: 'Your collection tags', tags: allCollectionTags.slice(0, 12) },
            ]}
          />
          {missingOnOtherLots && (
            <button className="link-btn small" onClick={() => void setCollectionTagsForCard(card.name, item!.tags)}>
              Apply these tags to all {lots.length} lots of {card.name}
            </button>
          )}
        </>
      ) : (
        <div className="tag-empty">
          <span className="muted small">You don't own this card — collection tags live on owned copies.</span>
          <button className="btn btn-sm" onClick={async () => { await addItems([{ card }]); toast(`Added ${card.name} to your collection`, 'success'); }}>
            + Add 1 to collection
          </button>
        </div>
      )}
    </Section>
  );

  const img = cardImage(card, 'small');
  return (
    <Modal onClose={onClose} title={`Tag ${card.name}`}>
      <div className="tag-modal">
        <div className="tag-modal-head">
          {img && <img src={img} alt="" className="tag-modal-img" />}
          <div>
            <TagLegend />
            <p className="muted small">
              Search any kind with <code>tag:</code>, or one kind with <code>{SCOPE_META.card.key}:</code>{' '}
              <code>{SCOPE_META.deck.key}:</code> <code>{SCOPE_META.collection.key}:</code> — in every search box.
            </p>
          </div>
        </div>
        {lead === 'collection' ? [collectionSection, deckSection] : [deckSection, collectionSection]}
      </div>
    </Modal>
  );
}

function Section({ title, lead, aside, children }: { title: string; lead: boolean; aside?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(lead);
  return (
    <section className={`tag-section ${lead ? 'lead' : ''}`}>
      <div className="tag-section-head">
        <button type="button" className="tag-section-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="caret">{open ? '▾' : '▸'}</span><h3>{title}</h3>
        </button>
        {aside}
      </div>
      {open && children}
    </section>
  );
}
