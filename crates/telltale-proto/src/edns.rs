//! EDNS(0) OPT pseudo-record (RFC 6891). REQ: DNS-005.

use crate::ParseError;
use crate::consts::{MIN_UDP_PAYLOAD, opt};

/// A parsed OPT record from a query, borrowing its options from the message.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Edns<'a> {
    /// Requestor's UDP payload size, raised to 512 if smaller (RFC 6891 §6.2.5).
    pub udp_payload: u16,
    /// Upper 8 bits of the extended RCODE.
    pub ext_rcode: u8,
    pub version: u8,
    /// DNSSEC OK bit.
    pub dnssec_ok: bool,
    /// Raw option bytes (sequence of code/length/value), already validated for framing.
    pub options: &'a [u8],
}

impl<'a> Edns<'a> {
    /// Parses the OPT fixed fields: `class` = UDP size, `ttl` = ext-rcode/version/flags.
    pub(crate) fn from_parts(class: u16, ttl: u32, rdata: &'a [u8]) -> Result<Self, ParseError> {
        validate_options(rdata)?;
        let [ext_rcode, version, flags_hi, _] = ttl.to_be_bytes();
        Ok(Self {
            udp_payload: class.max(MIN_UDP_PAYLOAD),
            ext_rcode,
            version,
            dnssec_ok: flags_hi & 0x80 != 0,
            options: rdata,
        })
    }

    /// Iterates `(code, value)` pairs.
    pub fn iter(&self) -> OptionIter<'a> {
        OptionIter { rest: self.options }
    }

    /// Value of the first option with `code`.
    pub fn option(&self, code: u16) -> Option<&'a [u8]> {
        self.iter().find(|(c, _)| *c == code).map(|(_, v)| v)
    }

    /// EDNS Client Subnet option value (RFC 7871).
    pub fn client_subnet(&self) -> Option<&'a [u8]> {
        self.option(opt::ECS)
    }

    /// DNS cookie option value (RFC 7873).
    pub fn cookie(&self) -> Option<&'a [u8]> {
        self.option(opt::COOKIE)
    }

    /// Client MAC from dnsmasq's `add-mac` option, for client identification (FLT-006).
    ///
    /// dnsmasq never sends the MAC as raw bytes: `add-mac` (the default) sends base64 and
    /// `add-mac=text` sends `aa:bb:cc:dd:ee:ff`. Accept raw bytes too, for other forwarders.
    pub fn client_mac(&self) -> Option<[u8; 6]> {
        let value = self.option(opt::DNSMASQ_MAC)?;
        if let Ok(raw) = <[u8; 6]>::try_from(value) {
            return Some(raw);
        }
        if value.len() == 17 {
            return text_mac(value);
        }
        base64_mac(value)
    }

    /// TelltaleDNS loop-detection tag, if present (`spec/04` §7).
    pub fn loop_tag(&self) -> Option<&'a [u8]> {
        self.option(opt::TELLTALE_LOOP)
    }
}

/// `aa:bb:cc:dd:ee:ff` (`add-mac=text`).
fn text_mac(value: &[u8]) -> Option<[u8; 6]> {
    if value.iter().skip(2).step_by(3).any(|b| *b != b':') {
        return None;
    }
    let mut mac = [0u8; 6];
    for (i, byte) in mac.iter_mut().enumerate() {
        let pair = std::str::from_utf8(&value[i * 3..i * 3 + 2]).ok()?;
        *byte = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(mac)
}

/// Standard base64 without padding (`add-mac`): 6 bytes are always 8 characters.
fn base64_mac(value: &[u8]) -> Option<[u8; 6]> {
    if value.len() != 8 {
        return None;
    }
    let mut out = [0u8; 6];
    let mut acc: u32 = 0;
    let mut bits = 0u32;
    let mut written = 0usize;
    for c in value {
        let digit = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        };
        acc = (acc << 6) | u32::from(digit);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            let slot = out.get_mut(written)?;
            *slot = ((acc >> bits) & 0xff) as u8;
            written += 1;
        }
    }
    (written == 6).then_some(out)
}

impl<'a> IntoIterator for &Edns<'a> {
    type Item = (u16, &'a [u8]);
    type IntoIter = OptionIter<'a>;
    fn into_iter(self) -> OptionIter<'a> {
        self.iter()
    }
}

/// Iterator over EDNS options (`code`, `value`).
#[derive(Clone, Debug)]
pub struct OptionIter<'a> {
    rest: &'a [u8],
}

impl<'a> Iterator for OptionIter<'a> {
    type Item = (u16, &'a [u8]);
    fn next(&mut self) -> Option<Self::Item> {
        let (code, len, rest) = match self.rest {
            [c0, c1, l0, l1, rest @ ..] => (
                u16::from_be_bytes([*c0, *c1]),
                usize::from(u16::from_be_bytes([*l0, *l1])),
                rest,
            ),
            _ => return None,
        };
        let value = rest.get(..len)?;
        self.rest = &rest[len..];
        Some((code, value))
    }
}

fn validate_options(mut rdata: &[u8]) -> Result<(), ParseError> {
    while !rdata.is_empty() {
        let [_, _, l0, l1, rest @ ..] = rdata else {
            return Err(ParseError::BadOption);
        };
        let len = usize::from(u16::from_be_bytes([*l0, *l1]));
        rdata = rest.get(len..).ok_or(ParseError::BadOption)?;
    }
    Ok(())
}

/// EDNS parameters for a response we write.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct EdnsOut<'a> {
    /// Our advertised UDP payload size (DNS-005, default 1232).
    pub udp_payload: u16,
    pub dnssec_ok: bool,
    /// Extended DNS Error to attach: info code + UTF-8 extra text (RFC 8914). REQ: DNS-013.
    pub ede: Option<(u16, &'a str)>,
}

impl EdnsOut<'_> {
    pub const fn new(udp_payload: u16) -> Self {
        Self {
            udp_payload,
            dnssec_ok: false,
            ede: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dns_005_dnsmasq_mac_encodings() {
        // `add-mac` (base64) and `add-mac=text`, as dnsmasq 2.91 sends them.
        let b64 = b"AQIDBAUG";
        let text = b"0a:0B:0c:0D:0e:0F";
        for (value, want) in [
            (&b64[..], [1, 2, 3, 4, 5, 6]),
            (&text[..], [10, 11, 12, 13, 14, 15]),
        ] {
            let mut rdata = vec![0xFD, 0xE9, 0x00, u8::try_from(value.len()).unwrap()];
            rdata.extend_from_slice(value);
            let e = Edns::from_parts(4096, 0, &rdata).unwrap();
            assert_eq!(e.client_mac(), Some(want));
        }
        for bad in [&b"not base64"[..], &b"aa:bb:cc:dd:ee"[..]] {
            let mut rdata = vec![0xFD, 0xE9, 0x00, u8::try_from(bad.len()).unwrap()];
            rdata.extend_from_slice(bad);
            assert_eq!(
                Edns::from_parts(4096, 0, &rdata).unwrap().client_mac(),
                None
            );
        }
    }

    #[test]
    fn dns_005_option_iteration_and_validation() {
        let rdata = [
            0x00, 0x0A, 0x00, 0x02, 0xAB, 0xCD, // cookie
            0xFD, 0xE9, 0x00, 0x06, 1, 2, 3, 4, 5, 6, // dnsmasq MAC
        ];
        let e = Edns::from_parts(4096, 0x0000_8000, &rdata).unwrap();
        assert!(e.dnssec_ok);
        assert_eq!(e.udp_payload, 4096);
        assert_eq!(e.cookie(), Some(&[0xAB, 0xCD][..]));
        assert_eq!(e.client_mac(), Some([1, 2, 3, 4, 5, 6]));
        assert_eq!(e.client_subnet(), None);
        assert_eq!(e.iter().count(), 2);
        assert_eq!(
            Edns::from_parts(512, 0, &[0, 8, 0, 9, 1]),
            Err(ParseError::BadOption)
        );
        assert_eq!(Edns::from_parts(100, 0, &[]).unwrap().udp_payload, 512);
    }
}
