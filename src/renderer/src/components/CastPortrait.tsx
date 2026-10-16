import { useStore } from '@/store/store';
import { SpritePortrait } from './SpritePortrait';
import { KaltelaSpritePortrait } from './KaltelaSpritePortrait';
import { asOfficeCastCharacter, type OfficeCharacterName } from '@/scene/office/cast';
import { KALTELA_CAST_BY_NAME, type KaltelaCharacterName } from '@/scene/office/kaltelaCast';

// KaltelaSpritePortrait's native frame (32×48) is wider than SpritePortrait's
// (18×28 — portraitArt.ts PORTRAIT_W/H), so the same `scale` prop would render
// it visibly bigger. This ratio keeps both portraits the same on-screen size
// for a given `scale`, so swapping themes doesn't resize every avatar slot.
const KALTELA_SCALE_RATIO = 18 / 32;

export interface CastPortraitProps {
  character: OfficeCharacterName | KaltelaCharacterName;
  /** Pixels per source pixel, in SpritePortrait's (office) frame terms — see
   *  KALTELA_SCALE_RATIO above for how the kaltela branch is scaled to match. */
  scale?: number;
  background?: string;
}

/** Theme-aware static agent avatar. `Agent.character` holds a KALTELA_CAST
 *  name under the kaltela theme (store.ts), which SpritePortrait can't render
 *  (it only knows the procedural OFFICE_CAST) — this picks the right renderer
 *  so every avatar slot (agent cards, the detail panel header, command-center
 *  lists, the archived list, the fullscreen terminal header) shows the actual
 *  kaltela look instead of silently falling back to the generic office one.
 *  The Add/Edit Agent character PICKER branches this itself (it needs the
 *  whole roster, not one portrait) and doesn't use this component. */
export function CastPortrait({ character, scale = 2, background = 'transparent' }: CastPortraitProps) {
  const officeTheme = useStore((s) => s.officeTheme);
  if (officeTheme === 'kaltela' && KALTELA_CAST_BY_NAME[character]) {
    return (
      <KaltelaSpritePortrait
        character={character as KaltelaCharacterName}
        scale={scale * KALTELA_SCALE_RATIO}
        background={background}
      />
    );
  }
  return <SpritePortrait character={asOfficeCastCharacter(character)} scale={scale} background={background} />;
}
