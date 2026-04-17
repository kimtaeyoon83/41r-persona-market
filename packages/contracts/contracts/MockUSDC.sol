// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title MockUSDC
 * @notice Test USDC for 41rpm x402 demo on BSC testnet.
 *
 *         Implements:
 *          - ERC20 with 6 decimals (matches mainnet Circle USDC)
 *          - EIP-3009 transferWithAuthorization / receiveWithAuthorization /
 *            cancelAuthorization — required by the x402 Exact EVM scheme
 *          - Public mint() faucet (anyone can mint up to 1000 USDC per call)
 *
 *         This is NOT real USDC. It exists purely so the x402 demo can run
 *         end-to-end on BSC testnet, where Circle does not operate a faucet.
 */
contract MockUSDC is ERC20, EIP712 {
    // keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH =
        0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267;

    // keccak256("ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")
    bytes32 private constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH =
        0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8;

    // keccak256("CancelAuthorization(address authorizer,bytes32 nonce)")
    bytes32 private constant CANCEL_AUTHORIZATION_TYPEHASH =
        0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429;

    /// @dev authorizer => nonce => used
    mapping(address => mapping(bytes32 => bool)) private _authorizationStates;

    /// @dev Faucet cap per mint call (1000 USDC = 1000 * 10^6)
    uint256 public constant FAUCET_CAP = 1_000 * 10 ** 6;

    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

    error AuthorizationExpired();
    error AuthorizationNotYetValid();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();
    error CallerIsNotPayee();
    error FaucetAmountTooLarge();

    constructor() ERC20("Mock USDC", "USDC") EIP712("USDC", "1") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    // -------------------------------------------------------------------
    // Public faucet — testnet only
    // -------------------------------------------------------------------

    /**
     * @notice Mint test USDC. Capped at 1000 USDC per call so it can't be
     *         drained. Anyone may call.
     */
    function mint(address to, uint256 amount) external {
        if (amount > FAUCET_CAP) revert FaucetAmountTooLarge();
        _mint(to, amount);
    }

    // -------------------------------------------------------------------
    // EIP-3009
    // -------------------------------------------------------------------

    /**
     * @notice Execute a transfer using a signed authorization. Anyone holding
     *         a valid EIP-3009 signature from `from` may relay this call.
     *         This is the primary entrypoint used by the x402 Exact EVM scheme.
     */
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        _verifySignature(from, structHash, v, r, s);

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Same as transferWithAuthorization but msg.sender must be the
     *         payee (recipient). Prevents front-running where a third party
     *         relays to an unintended destination.
     */
    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (msg.sender != to) revert CallerIsNotPayee();
        _requireValidAuthorization(from, nonce, validAfter, validBefore);

        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce
            )
        );
        _verifySignature(from, structHash, v, r, s);

        _authorizationStates[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);
        _transfer(from, to, value);
    }

    /**
     * @notice Cancel an unused authorization. Authorizer must sign.
     */
    function cancelAuthorization(
        address authorizer,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce)
        );
        _verifySignature(authorizer, structHash, v, r, s);

        _authorizationStates[authorizer][nonce] = true;
        emit AuthorizationCanceled(authorizer, nonce);
    }

    /**
     * @notice Returns true if the authorization nonce for `authorizer` has
     *         already been used or canceled.
     */
    function authorizationState(address authorizer, bytes32 nonce)
        external
        view
        returns (bool)
    {
        return _authorizationStates[authorizer][nonce];
    }

    // -------------------------------------------------------------------
    // Internal
    // -------------------------------------------------------------------

    function _requireValidAuthorization(
        address authorizer,
        bytes32 nonce,
        uint256 validAfter,
        uint256 validBefore
    ) internal view {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (_authorizationStates[authorizer][nonce]) revert AuthorizationAlreadyUsed();
    }

    function _verifySignature(address expected, bytes32 structHash, uint8 v, bytes32 r, bytes32 s)
        internal
        view
    {
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, v, r, s);
        if (signer != expected) revert InvalidSignature();
    }
}
