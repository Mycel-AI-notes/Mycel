import {
  Activity, Anchor, Apple, Archive, Atom, Bike, Bird, Book, BookOpen, Bookmark,
  Bot, Box, Brain, Briefcase, Brush, Bug, Building2, Calendar, Camera, Car,
  Cat, ChartLine, CircleCheck, ClipboardList, Clock, Cloud, Code, Coffee,
  Compass, Cpu, Crown, Database, Dog, Droplet, Dumbbell, Eye, Feather, FileText,
  Film, Fish, Flag, FlaskConical, Flame, Flower2, Folder, Gamepad2, Gem, Gift,
  Globe, GraduationCap, Hammer, Hash, Headphones, Heart, Hourglass, House, Image,
  Inbox, Infinity as InfinityIcon, Key, Layers, Leaf, Library, Lightbulb, Link,
  ListTodo, Lock, Mail, Map, MapPin, Medal, MessageCircle, Mic, Microscope, Moon,
  Mountain, Music, NotebookPen, Package, Palette, PenLine, Pill, PiggyBank, Plane,
  Puzzle, Quote, Rocket, Search, Server, Settings, Shell, Shield, ShoppingCart,
  Snowflake, Sparkles, Sprout, Star, Stethoscope, Sun, Target, Telescope,
  Terminal, TreePine, TrendingUp, Trophy, User, Users, Utensils, Wallet, Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import { TAG_HUES } from '@/components/database/cells/tagColor';

/**
 * The page-icon set: line icons from the same family as the rest of the
 * chrome, tinted from the tag palette. Stored in frontmatter by their
 * kebab-case name (`icon: sprout`) so the file stays readable. The list is
 * curated rather than "all of lucide" — a picker of 1,500 glyphs is a search
 * box, not a choice, and importing them all would bloat the bundle.
 */
export const PAGE_ICONS: Record<string, { Icon: LucideIcon; keywords: string }> = {
  sprout: { Icon: Sprout, keywords: 'mycel grow seed plant start' },
  leaf: { Icon: Leaf, keywords: 'nature plant eco' },
  'tree-pine': { Icon: TreePine, keywords: 'forest nature' },
  flower: { Icon: Flower2, keywords: 'bloom garden' },
  shell: { Icon: Shell, keywords: 'spiral sea' },
  mountain: { Icon: Mountain, keywords: 'goal climb peak' },
  sun: { Icon: Sun, keywords: 'day light weather' },
  moon: { Icon: Moon, keywords: 'night sleep' },
  cloud: { Icon: Cloud, keywords: 'weather sky' },
  droplet: { Icon: Droplet, keywords: 'water' },
  snowflake: { Icon: Snowflake, keywords: 'cold winter' },
  flame: { Icon: Flame, keywords: 'fire hot urgent' },
  zap: { Icon: Zap, keywords: 'lightning energy fast action' },
  sparkles: { Icon: Sparkles, keywords: 'ai magic new' },
  star: { Icon: Star, keywords: 'favorite important' },
  heart: { Icon: Heart, keywords: 'love health like' },
  lightbulb: { Icon: Lightbulb, keywords: 'idea insight' },
  brain: { Icon: Brain, keywords: 'think mind ai ml' },
  atom: { Icon: Atom, keywords: 'science physics' },
  flask: { Icon: FlaskConical, keywords: 'experiment lab research' },
  microscope: { Icon: Microscope, keywords: 'research science study' },
  telescope: { Icon: Telescope, keywords: 'explore research vision' },
  rocket: { Icon: Rocket, keywords: 'launch project startup' },
  target: { Icon: Target, keywords: 'goal okr focus' },
  flag: { Icon: Flag, keywords: 'milestone goal' },
  trophy: { Icon: Trophy, keywords: 'win achievement' },
  medal: { Icon: Medal, keywords: 'award' },
  crown: { Icon: Crown, keywords: 'king best' },
  gem: { Icon: Gem, keywords: 'diamond value' },
  bookmark: { Icon: Bookmark, keywords: 'save read later' },
  book: { Icon: Book, keywords: 'read reading' },
  'book-open': { Icon: BookOpen, keywords: 'read notes study' },
  library: { Icon: Library, keywords: 'books collection' },
  'graduation-cap': { Icon: GraduationCap, keywords: 'study course learn education' },
  notebook: { Icon: NotebookPen, keywords: 'journal notes diary' },
  pen: { Icon: PenLine, keywords: 'write draft edit' },
  feather: { Icon: Feather, keywords: 'write essay blog' },
  quote: { Icon: Quote, keywords: 'citation saying' },
  'file-text': { Icon: FileText, keywords: 'document page' },
  folder: { Icon: Folder, keywords: 'directory collection' },
  archive: { Icon: Archive, keywords: 'old store' },
  inbox: { Icon: Inbox, keywords: 'capture incoming' },
  clipboard: { Icon: ClipboardList, keywords: 'plan list project' },
  'list-todo': { Icon: ListTodo, keywords: 'tasks checklist' },
  check: { Icon: CircleCheck, keywords: 'done complete' },
  calendar: { Icon: Calendar, keywords: 'date event meeting daily' },
  clock: { Icon: Clock, keywords: 'time' },
  hourglass: { Icon: Hourglass, keywords: 'waiting later' },
  briefcase: { Icon: Briefcase, keywords: 'work job career' },
  building: { Icon: Building2, keywords: 'company office' },
  house: { Icon: House, keywords: 'home personal' },
  'map-pin': { Icon: MapPin, keywords: 'place location' },
  map: { Icon: Map, keywords: 'travel plan roadmap' },
  compass: { Icon: Compass, keywords: 'direction explore' },
  globe: { Icon: Globe, keywords: 'world web travel' },
  plane: { Icon: Plane, keywords: 'travel trip flight' },
  car: { Icon: Car, keywords: 'drive transport' },
  bike: { Icon: Bike, keywords: 'cycle sport' },
  code: { Icon: Code, keywords: 'dev programming' },
  terminal: { Icon: Terminal, keywords: 'cli shell dev' },
  cpu: { Icon: Cpu, keywords: 'hardware chip' },
  database: { Icon: Database, keywords: 'data storage' },
  server: { Icon: Server, keywords: 'backend infra' },
  bot: { Icon: Bot, keywords: 'ai agent telegram robot' },
  puzzle: { Icon: Puzzle, keywords: 'plugin problem' },
  layers: { Icon: Layers, keywords: 'stack design' },
  box: { Icon: Box, keywords: 'product 3d' },
  package: { Icon: Package, keywords: 'release ship' },
  wrench: { Icon: Wrench, keywords: 'fix tool' },
  hammer: { Icon: Hammer, keywords: 'build tool' },
  settings: { Icon: Settings, keywords: 'config gear' },
  palette: { Icon: Palette, keywords: 'design art color' },
  brush: { Icon: Brush, keywords: 'art paint design' },
  camera: { Icon: Camera, keywords: 'photo' },
  image: { Icon: Image, keywords: 'picture cv vision' },
  film: { Icon: Film, keywords: 'movie video' },
  music: { Icon: Music, keywords: 'song audio' },
  headphones: { Icon: Headphones, keywords: 'podcast listen' },
  mic: { Icon: Mic, keywords: 'voice talk' },
  gamepad: { Icon: Gamepad2, keywords: 'game play' },
  gift: { Icon: Gift, keywords: 'present birthday' },
  'shopping-cart': { Icon: ShoppingCart, keywords: 'buy shop' },
  wallet: { Icon: Wallet, keywords: 'money finance' },
  'piggy-bank': { Icon: PiggyBank, keywords: 'save money budget' },
  'chart-line': { Icon: ChartLine, keywords: 'stats analytics metrics' },
  'trending-up': { Icon: TrendingUp, keywords: 'growth' },
  users: { Icon: Users, keywords: 'team people meeting' },
  user: { Icon: User, keywords: 'person profile' },
  message: { Icon: MessageCircle, keywords: 'chat comment' },
  mail: { Icon: Mail, keywords: 'email letter' },
  coffee: { Icon: Coffee, keywords: 'break cafe' },
  utensils: { Icon: Utensils, keywords: 'food recipe' },
  apple: { Icon: Apple, keywords: 'food fruit health' },
  dumbbell: { Icon: Dumbbell, keywords: 'gym sport fitness' },
  activity: { Icon: Activity, keywords: 'health pulse' },
  stethoscope: { Icon: Stethoscope, keywords: 'doctor medical' },
  pill: { Icon: Pill, keywords: 'medicine health' },
  shield: { Icon: Shield, keywords: 'security safe' },
  lock: { Icon: Lock, keywords: 'private secret' },
  key: { Icon: Key, keywords: 'access password' },
  eye: { Icon: Eye, keywords: 'watch view' },
  search: { Icon: Search, keywords: 'find research' },
  link: { Icon: Link, keywords: 'url web' },
  anchor: { Icon: Anchor, keywords: 'sea stable' },
  hash: { Icon: Hash, keywords: 'tag topic' },
  infinity: { Icon: InfinityIcon, keywords: 'forever loop' },
  dog: { Icon: Dog, keywords: 'pet animal' },
  cat: { Icon: Cat, keywords: 'pet animal' },
  bird: { Icon: Bird, keywords: 'animal twitter' },
  fish: { Icon: Fish, keywords: 'animal sea' },
  bug: { Icon: Bug, keywords: 'issue debug' },
};

/**
 * Emoji for people who want them. Native emoji bring their own colours, so
 * the set is small and leans to calm, flat-reading glyphs.
 */
export const PAGE_EMOJI = [
  '🌱', '🌿', '🍄', '🌳', '🌸', '🌻', '🌙', '☀️', '⭐', '✨', '🔥', '⚡',
  '💡', '🧠', '🧪', '🔬', '🔭', '🚀', '🎯', '🏁', '🏆', '💎', '📌', '📍',
  '📚', '📖', '📓', '📝', '✏️', '🗂️', '📁', '🗃️', '📥', '✅', '📅', '⏳',
  '💼', '🏢', '🏠', '🗺️', '🧭', '🌍', '✈️', '🚲', '💻', '⌨️', '🤖', '🧩',
  '🛠️', '⚙️', '🎨', '📷', '🎬', '🎵', '🎧', '🎮', '🎁', '🛒', '💰', '📈',
  '👥', '💬', '✉️', '☕', '🍎', '🏋️', '❤️', '💊', '🛡️', '🔒', '🔑', '👀',
  '🔍', '🔗', '⚓', '♾️', '🐶', '🐱', '🐦', '🐟', '🐛', '🦊', '🐝', '🦋',
];

/**
 * Icon tints, by name so frontmatter reads `icon_color: teal` rather than a
 * palette index. Hues come from the tag palette so an icon and a select chip
 * of the same colour match. No colour means the theme's accent.
 */
export const ICON_COLORS: { name: string; hue: number }[] = [
  'red', 'orange', 'amber', 'lime', 'green', 'teal',
  'cyan', 'sky', 'blue', 'violet', 'purple', 'pink',
].map((name, i) => ({ name, hue: TAG_HUES[i] }));

export function iconHue(color: string | null | undefined): number | null {
  if (!color) return null;
  return ICON_COLORS.find((c) => c.name === color.toLowerCase())?.hue ?? null;
}
