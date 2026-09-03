import re
DAYS_EN = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]

BREAKFAST_GR = {
    "drinks":  ["Τσάι", "Γάλα", "Χυμός"],
    "spreads": ["Μαρμελάδα 2 είδη", "Μέλι", "Βούτυρο", "Μαργαρίνη", "Τυρί Edam", "Ζαμπόν"],
    "breads":  ["Ψωμί Λευκό-μαύρο", "Φρυγανιές"],
    "staples": ["Αυγό", "Κέικ", "Corn Flakes (Δημητριακά)"],
}

BREAKFAST_EN = {
    "drinks":  ["Tea", "Milk", "Juice"],
    "spreads": ["Jam (2 varieties)", "Honey", "Butter", "Margarine", "Edam Cheese", "Ham"],
    "breads":  ["White/Brown Bread", "Rusks"],
    "staples": ["Egg", "Cake", "Corn Flakes (Cereal)"],
}

SKIP_PATTERNS = [
    r"^\d+η\s*εβδομάδα",
    r"^Πρωινό",
    r"^Τσάι",
    r"^ΓΕΥΜΑ",
    r"^ΔΕΙΠΝΟ",
    r"^Πρώτο Πιάτο",
    r"^Κυρίως Πιάτο",
    r"^Τυρί",
    r"^Δυο \(2\)",
    r"^Δύο \(2\)",
    r"^(Γλυκό|Φρούτο)$",
    r"^Δευτέρα",
]

SKIP_RE = re.compile("|".join(SKIP_PATTERNS))
