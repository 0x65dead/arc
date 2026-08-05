import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { useAccount, usePublicClient } from 'wagmi';
import type { Address } from 'viem';
import { registryAbi, resolverAbi } from '../config/abis';
import { contracts } from '../config/contracts';
import { fullName, nodeForLabel } from '../lib/names';
import { queryKeys } from '../lib/queryKeys';
import { useTx } from './useTx';

/** Text record keys offered in the UI. Any key is valid on-chain. */
export const TEXT_KEYS = ['description', 'url', 'avatar', 'com.twitter', 'com.github', 'email'] as const;
export type TextKey = (typeof TEXT_KEYS)[number];

export interface NameRecords {
  /** Resolver bound to the name in the registry — zero address means none. */
  resolver: Address | null;
  addr: Address | null;
  texts: Partial<Record<TextKey, string>>;
}

export function useRecords(label: string) {
  const publicClient = usePublicClient();

  return useQuery<NameRecords>({
    queryKey: queryKeys.records(label),
    enabled: Boolean(publicClient && label),
    staleTime: 30_000,
    queryFn: async (): Promise<NameRecords> => {
      if (!publicClient) throw new Error('No RPC client available');
      const node = nodeForLabel(label);

      // The resolver is read from the registry rather than assumed to be the
      // deployment's default: a name's owner can point it anywhere, and writing
      // to the wrong resolver silently records data nothing will ever read.
      const resolver = await publicClient.readContract({
        address: contracts.registry,
        abi: registryAbi,
        functionName: 'resolver',
        args: [node],
      });

      if (!resolver || resolver === '0x0000000000000000000000000000000000000000') {
        return { resolver: null, addr: null, texts: {} };
      }

      const [addr, ...textValues] = await Promise.all([
        publicClient
          .readContract({ address: resolver, abi: resolverAbi, functionName: 'addr', args: [node] })
          .catch(() => null),
        ...TEXT_KEYS.map((key) =>
          publicClient
            .readContract({ address: resolver, abi: resolverAbi, functionName: 'text', args: [node, key] })
            .catch(() => ''),
        ),
      ]);

      const texts: Partial<Record<TextKey, string>> = {};
      TEXT_KEYS.forEach((key, index) => {
        const value = textValues[index];
        if (value) texts[key] = value;
      });

      return {
        resolver,
        addr: addr && addr !== '0x0000000000000000000000000000000000000000' ? addr : null,
        texts,
      };
    },
  });
}

export function useRecordActions(label: string) {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { runTx } = useTx();

  const resolverFor = useCallback(async (): Promise<Address> => {
    if (!publicClient) throw new Error('No RPC client available');
    const node = nodeForLabel(label);
    const bound = await publicClient.readContract({
      address: contracts.registry,
      abi: registryAbi,
      functionName: 'resolver',
      args: [node],
    });
    return bound && bound !== '0x0000000000000000000000000000000000000000' ? bound : contracts.resolver;
  }, [label, publicClient]);

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.records(label) });
  }, [label, queryClient]);

  const setAddress = useCallback(
    async (value: Address) => {
      const resolver = await resolverFor();
      await runTx({
        pending: `Updating the address for ${fullName(label)}`,
        success: 'Address record updated',
        request: {
          address: resolver,
          abi: resolverAbi,
          functionName: 'setAddr',
          args: [nodeForLabel(label), value],
        },
      });
      invalidate();
    },
    [invalidate, label, resolverFor, runTx],
  );

  const setText = useCallback(
    async (key: string, value: string) => {
      const resolver = await resolverFor();
      await runTx({
        pending: `Updating ${key} for ${fullName(label)}`,
        success: `${key} updated`,
        request: {
          address: resolver,
          abi: resolverAbi,
          functionName: 'setText',
          args: [nodeForLabel(label), key, value],
        },
      });
      invalidate();
    },
    [invalidate, label, resolverFor, runTx],
  );

  /** Points the name at the default resolver when it has none bound yet. */
  const bindResolver = useCallback(async () => {
    await runTx({
      pending: `Setting a resolver for ${fullName(label)}`,
      success: 'Resolver set',
      request: {
        address: contracts.registry,
        abi: registryAbi,
        functionName: 'setResolver',
        args: [nodeForLabel(label), contracts.resolver],
      },
    });
    invalidate();
  }, [invalidate, label, runTx]);

  return { setAddress, setText, bindResolver };
}

/**
 * The name shown for the connected address, via the reverse registrar.
 *
 * `reverse()` returns a `verified` flag: it forward-resolves the claimed name
 * and checks it points back at the address. An unverified reverse record is a
 * claim anyone can make, so it is not displayed as if it were confirmed.
 */
export function usePrimaryName(address: Address | undefined) {
  const publicClient = usePublicClient();

  return useQuery({
    queryKey: queryKeys.primaryName(address),
    enabled: Boolean(publicClient && address),
    staleTime: 60_000,
    queryFn: async (): Promise<{ name: string | null; verified: boolean }> => {
      if (!publicClient || !address) throw new Error('No address');
      try {
        const [name, verified] = await publicClient.readContract({
          address: contracts.universalResolver,
          abi: [
            {
              type: 'function',
              name: 'reverse',
              stateMutability: 'view',
              inputs: [{ name: 'a', type: 'address' }],
              outputs: [
                { name: 'name', type: 'string' },
                { name: 'verified', type: 'bool' },
              ],
            },
          ] as const,
          functionName: 'reverse',
          args: [address],
        });
        return { name: name || null, verified };
      } catch {
        return { name: null, verified: false };
      }
    },
  });
}

/** Sets the connected wallet's primary (reverse) name. */
export function useSetPrimaryName() {
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { runTx } = useTx();

  return useCallback(
    async (label: string) => {
      if (!publicClient || !address) return;

      // The reverse node must exist before a name can be written to it. Claim
      // is idempotent, so calling it when the node already exists is harmless —
      // and skipping it when it doesn't is a revert.
      const reverseNode = await publicClient.readContract({
        address: contracts.reverseRegistrar,
        abi: [
          {
            type: 'function',
            name: 'node',
            stateMutability: 'view',
            inputs: [{ name: 'a', type: 'address' }],
            outputs: [{ name: '', type: 'bytes32' }],
          },
        ] as const,
        functionName: 'node',
        args: [address],
      });

      const owner = await publicClient
        .readContract({
          address: contracts.registry,
          abi: registryAbi,
          functionName: 'owner',
          args: [reverseNode],
        })
        .catch(() => '0x0000000000000000000000000000000000000000' as Address);

      if (owner.toLowerCase() !== address.toLowerCase()) {
        const claimed = await runTx({
          pending: 'Claiming your reverse record',
          success: 'Reverse record claimed',
          request: {
            address: contracts.reverseRegistrar,
            abi: [
              { type: 'function', name: 'claim', stateMutability: 'nonpayable', inputs: [], outputs: [{ name: '', type: 'bytes32' }] },
            ] as const,
            functionName: 'claim',
          },
        });
        if (!claimed) return;
      }

      const resolver = await publicClient.readContract({
        address: contracts.registry,
        abi: registryAbi,
        functionName: 'resolver',
        args: [reverseNode],
      });

      const target =
        resolver && resolver !== '0x0000000000000000000000000000000000000000' ? resolver : contracts.resolver;

      await runTx({
        pending: `Setting ${fullName(label)} as your primary name`,
        success: `${fullName(label)} is now your primary name`,
        request: {
          address: target,
          abi: resolverAbi,
          functionName: 'setName',
          args: [reverseNode, fullName(label)],
        },
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.primaryName(address) });
    },
    [address, publicClient, queryClient, runTx],
  );
}
