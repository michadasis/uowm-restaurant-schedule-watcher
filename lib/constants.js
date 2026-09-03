export const DAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

export const BREAKFAST_GR = {
  drinks: ["Τσάι", "Γάλα", "Χυμός"],
  spreads: ["Μαρμελάδα 2 είδη", "Μέλι", "Βούτυρο", "Μαργαρίνη", "Τυρί Edam", "Ζαμπόν"],
  breads: ["Ψωμί Λευκό-μαύρο", "Φρυγανιές"],
  staples: ["Αυγό", "Κέικ", "Corn Flakes (Δημητριακά)"],
};

export const BREAKFAST_EN = {
  drinks: ["Tea", "Milk", "Juice"],
  spreads: ["Jam (2 varieties)", "Honey", "Butter", "Margarine", "Edam Cheese", "Ham"],
  breads: ["White/Brown Bread", "Rusks"],
  staples: ["Egg", "Cake", "Corn Flakes (Cereal)"],
};

const SKIP_PATTERNS = [
  /^\d+η\s*εβδομάδα/,
  /^Πρωινό/,
  /^Τσάι/,
  /^ΓΕΥΜΑ/,
  /^ΔΕΙΠΝΟ/,
  /^Πρώτο Πιάτο/,
  /^Κυρίως Πιάτο/,
  /^Τυρί/,
  /^Δυο \(2\)/,
  /^Δύο \(2\)/,
  /^(Γλυκό|Φρούτο)$/,
  /^Δευτέρα/,
];

export const SKIP_RE = new RegExp(SKIP_PATTERNS.map((r) => r.source).join("|"));
