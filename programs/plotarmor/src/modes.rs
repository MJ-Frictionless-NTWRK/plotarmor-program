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
