// The Lucide icons a studio extension kind may name ("icon": "sparkles");
// a fixed set, so the bundle carries only these. Unknown names get circle-dot.
import {
  Bell, Box, Bug, CircleDot, Crosshair, Droplet, Egg, Eye, Flag, Flame, Gem, Ghost, Heart, Key,
  Leaf, Lock, MapPin, Music, Package, Shield, Skull, Sparkles, Star, Swords, Target, Zap, type IconNode,
} from "lucide";

export const EXT_ICONS: Record<string, IconNode> = {
  bell: Bell, box: Box, bug: Bug, "circle-dot": CircleDot, crosshair: Crosshair, droplet: Droplet,
  egg: Egg, eye: Eye, flag: Flag, flame: Flame, gem: Gem, ghost: Ghost, heart: Heart, key: Key,
  leaf: Leaf, lock: Lock, "map-pin": MapPin, music: Music, package: Package, shield: Shield,
  skull: Skull, sparkles: Sparkles, star: Star, swords: Swords, target: Target, zap: Zap,
};

// [cache name, icon] for a kind's icon name
export function extIcon(name: string | undefined): [string, IconNode] {
  const key = name && EXT_ICONS[name] ? name : "circle-dot";
  return [`ext-${key}`, EXT_ICONS[key]];
}
