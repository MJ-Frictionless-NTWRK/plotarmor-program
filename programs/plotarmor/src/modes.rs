#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorMode {
    Simulated = 0,
    AttestedDevnet = 1,
    AttestedMainnet = 2,
    UserSigned = 3,
    MultiParty = 4,
}

impl AnchorMode {
    pub fn to_u8(self) -> u8 {
        self as u8
    }

    pub fn from_u8(value: u8) -> Result<Self, &'static str> {
        match value {
            0 => Ok(AnchorMode::Simulated),
            1 => Ok(AnchorMode::AttestedDevnet),
            2 => Ok(AnchorMode::AttestedMainnet),
            3 => Ok(AnchorMode::UserSigned),
            4 => Ok(AnchorMode::MultiParty),
            _ => Err("Invalid AnchorMode value"),
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchoredObjectKind {
    WorkClaim = 0,
    ContentArtifact = 1,
    EvidenceAnchor = 2,
    AuthorizedContractAnchor = 3,
}

impl AnchoredObjectKind {
    pub fn to_u8(self) -> u8 {
        self as u8
    }

    pub fn from_u8(value: u8) -> Result<Self, &'static str> {
        match value {
            0 => Ok(AnchoredObjectKind::WorkClaim),
            1 => Ok(AnchoredObjectKind::ContentArtifact),
            2 => Ok(AnchoredObjectKind::EvidenceAnchor),
            3 => Ok(AnchoredObjectKind::AuthorizedContractAnchor),
            _ => Err("Invalid AnchoredObjectKind value"),
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClaimKind {
    Unspecified = 0,
    Original    = 1,
    Adapted     = 2,
    WorkForHire = 3,
    Derivative  = 4,
    Assignment  = 5,
}

impl ClaimKind {
    pub fn from_u8(value: u8) -> Result<Self, &'static str> {
        match value {
            0 => Ok(ClaimKind::Unspecified),
            1 => Ok(ClaimKind::Original),
            2 => Ok(ClaimKind::Adapted),
            3 => Ok(ClaimKind::WorkForHire),
            4 => Ok(ClaimKind::Derivative),
            5 => Ok(ClaimKind::Assignment),
            _ => Err("Invalid ClaimKind value"),
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContractKind {
    Unspecified     = 0,
    Nda             = 1,
    WriterAgreement = 2,
    Collaboration   = 3,
    Option          = 4,
    OptionExtension = 5,
    OptionExercise  = 6,
    Purchase        = 7,
    Amendment       = 8,
    Assignment      = 9,
    License         = 10,
    Other           = 11,
}

impl ContractKind {
    pub fn from_u8(value: u8) -> Result<Self, &'static str> {
        match value {
            0  => Ok(ContractKind::Unspecified),
            1  => Ok(ContractKind::Nda),
            2  => Ok(ContractKind::WriterAgreement),
            3  => Ok(ContractKind::Collaboration),
            4  => Ok(ContractKind::Option),
            5  => Ok(ContractKind::OptionExtension),
            6  => Ok(ContractKind::OptionExercise),
            7  => Ok(ContractKind::Purchase),
            8  => Ok(ContractKind::Amendment),
            9  => Ok(ContractKind::Assignment),
            10 => Ok(ContractKind::License),
            11 => Ok(ContractKind::Other),
            _  => Err("Invalid ContractKind value"),
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ContentKind {
    Unspecified = 0,
    Screenplay  = 1,
    Treatment   = 2,
    Outline     = 3,
    Contract    = 4,
    Score       = 5,
    Master      = 6,
    Foley       = 7,
}

impl ContentKind {
    pub fn from_u8(value: u8) -> Result<Self, &'static str> {
        match value {
            0 => Ok(ContentKind::Unspecified),
            1 => Ok(ContentKind::Screenplay),
            2 => Ok(ContentKind::Treatment),
            3 => Ok(ContentKind::Outline),
            4 => Ok(ContentKind::Contract),
            5 => Ok(ContentKind::Score),
            6 => Ok(ContentKind::Master),
            7 => Ok(ContentKind::Foley),
            _ => Err("Invalid ContentKind value"),
        }
    }
}

#[repr(u8)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerRole {
    Unspecified = 0,
    Author      = 1,
    CoAuthor    = 2,
    Producer    = 3,
    Financier   = 4,
    Assignee    = 5,
}

impl OwnerRole {
    pub fn from_u8(value: u8) -> Result<Self, &'static str> {
        match value {
            0 => Ok(OwnerRole::Unspecified),
            1 => Ok(OwnerRole::Author),
            2 => Ok(OwnerRole::CoAuthor),
            3 => Ok(OwnerRole::Producer),
            4 => Ok(OwnerRole::Financier),
            5 => Ok(OwnerRole::Assignee),
            _ => Err("Invalid OwnerRole value"),
        }
    }
}
