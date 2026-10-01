/**
 * Every sentence the survey writes into a building or its report, as a message key with
 * values. The key travels with the building so the editor can show the sentence in its own
 * language, also after the language is switched; the German text below is the one place
 * each sentence is written, and it is also stored as the plain `note`, for readers that do
 * not know the keys. The editor's German messages are these same strings.
 *
 * Two value names are codes, not text: `roofType` is an AdV roof form code and `ageClass` an
 * age class id. A reader turns them into a label in its language.
 */
import { roofTypeLabel } from '../codelists.ts'

export const SURVEY_DE = {
  'survey.footprint': '{corners} Ecken, {area} m², aus dem LoD2-Grundriss vereinfacht',
  'survey.storeys.typed': '{count} Geschosse angegeben, gleich hoch',
  'survey.storeys.photo': '{count} Geschosse aus den Fensterreihen des Fotos',
  'survey.storeys.estimated': '{count} Geschosse aus {height} m Traufhöhe über Straße geschätzt',
  'survey.roof.type': '{roofType}',
  'survey.roof.unknown': 'Dachform unbekannt',
  'survey.roof.unknownType': 'unbekannt',
  'survey.roof.flatSimplified': '{roofType} als Flachdach vereinfacht',
  'survey.roof.mixedAsGable': 'Mischform als Satteldach vereinfacht',
  'survey.roof.hipAsGable': 'Walmdach auf nicht rechteckigem Grundriss als Satteldach',
  'survey.sharedEdges': '{count} Wände an Nachbargebäude, aus den LoD2-Grundrissen erkannt',
  'survey.constructions': 'Pauschalwerte {ageClass}, Bekanntmachung Datenaufnahme Wohngebäudebestand vom 8.10.2020',
  'survey.constructions.assumed':
    'Pauschalwerte {ageClass}, Bekanntmachung Datenaufnahme Wohngebäudebestand vom 8.10.2020, Baualtersklasse angenommen',
  'survey.opening.catalogue':
    'Kein Foto dieser Fassade: Fenster nach Bekanntmachung Datenaufnahme 2020, Tabelle 1 Zeile 1a (55 % der Wandbreite, lichte Raumhöhe minus 1,50 m)',
  'survey.opening.detected': 'Foto, automatisch erkannt',
  'survey.opening.detectedScore': 'Foto, automatisch erkannt, Konfidenz {confidence} %',
  'survey.opening.drawn': 'Foto, von Hand eingezeichnet',
  'survey.opening.wallEnd': 'an der Wandkante gekürzt',
  'survey.opening.slab': 'an der Geschossdecke gekürzt',
  'survey.opening.doorRaised': 'Tür {height} m über dem Fußboden, mit gemessener Höhe auf den Fußboden gesetzt',
  'survey.opening.doorAsWindow': 'Tür über dem Fußboden als Fenster übernommen',
  'survey.opening.overlap': 'wegen Überlappung gekürzt',
  'survey.warning.noTerrain': 'Keine Geländelinie: Höhen ab Bodenplatte des Modells.',
  'survey.warning.storeyMismatch': 'Das Foto zeigt {rows} Fensterreihen, angegeben sind {count} Geschosse.',
  'survey.warning.tallStoreys': '{count} Geschoss(e) höher als {height} m: prüfen, ob eine Fensterreihe fehlt.',
  'survey.warning.ageClassAssumed': 'Baualtersklasse nicht angegeben: {ageClass} angenommen.',
  'survey.warning.partyWall': 'Wand {wall} liegt an einem Nachbargebäude; ihre Öffnungen wurden nicht übernommen.',
  'survey.warning.noPhoto': 'Noch keine Fassade fotografiert: das Modell hat keine Fenster.',
  'survey.warning.otherParts': 'Das Gebäude hat {count} weitere Teile; nur dieser Teil wird übergeben.',
  'survey.failed.noGeometry': 'Dieser Gebäudeteil hat keine Geometrie.',
  'survey.failed.noGround': 'Dieser Gebäudeteil hat keine Grundfläche.',
  'survey.failed.tooSmall': 'Die Grundfläche ist zu klein.',
  'survey.ageClass.bis1918': 'bis 1918',
  'survey.ageClass.1919-1948': '1919 bis 1948',
  'survey.ageClass.1949-1957': '1949 bis 1957',
  'survey.ageClass.1958-1968': '1958 bis 1968',
  'survey.ageClass.1969-1978': '1969 bis 1978',
  'survey.ageClass.1979-1983': '1979 bis 1983',
  'survey.ageClass.1984-1994': '1984 bis 1994',
  'survey.ageClass.1995-2001': '1995 bis 2001',
  'survey.ageClass.ab2002': 'ab 2002',
  'survey.construction.oldWall': 'Vollziegel über 30 cm, ungedämmt',
  'survey.construction.cavityWall': 'Mauerwerk zweischalig, ungedämmt',
  'survey.construction.roof': 'Dach, Holzkonstruktion, Bestand',
  'survey.construction.floor': 'Kellerdecke Ziegel/Hohlstein, Bestand',
  'survey.construction.door': 'Tür Holz/Kunststoff, Bestand',
  'survey.construction.windowDouble': 'Holzfenster zwei Scheiben',
  'survey.construction.windowInsulated': 'Holzfenster Isolierglas',
} as const

export type SurveyMessageKey = keyof typeof SURVEY_DE

export interface SurveyMessage {
  key: SurveyMessageKey
  values?: Record<string, string | number>
}

export function message(key: SurveyMessageKey, values?: Record<string, string | number>): SurveyMessage {
  return values ? { key, values } : { key }
}

/** The message in German, numbers with a decimal comma. */
export function germanText(m: SurveyMessage): string {
  return SURVEY_DE[m.key].replace(/\{(\w+)\}/g, (_, name: string) => germanValue(name, m.values?.[name]))
}

/** Several messages as one note, the way the sources have always joined them. */
export function germanNote(messages: readonly SurveyMessage[]): string {
  return messages.map(germanText).join('; ')
}

function germanValue(name: string, value: string | number | undefined): string {
  if (value === undefined) return `{${name}}`
  if (name === 'roofType') return roofTypeLabel(String(value)) ?? SURVEY_DE['survey.roof.unknownType']
  if (name === 'ageClass') return SURVEY_DE[`survey.ageClass.${value}` as SurveyMessageKey] ?? String(value)
  return typeof value === 'number' ? String(value).replace('.', ',') : value
}
