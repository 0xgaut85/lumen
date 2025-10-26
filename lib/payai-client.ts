/**
 * PayAI x402 Client Library
 * Integrates with PayAI's facilitator infrastructure for x402 service discovery and payments
 */

export interface X402Service {
  id: string;
  name: string;
  description: string;
  endpoint: string;
  price: {
    amount: string;
    currency: 'USDC' | 'SOL';
    network: string;
  };
  category: string;
  status: 'online' | 'offline' | 'maintenance';
  responseTime?: number;
  rating?: number;
  totalCalls?: number;
  isTestService?: boolean; // Flag for test/free services like Echo Merchant
  lastUpdated?: string;
  // Payment details from discovery endpoint
  accepts?: Array<{
    asset: string;          // USDC contract address
    payTo: string;          // Merchant address
    network: string;        // base, solana-mainnet, etc
    maxAmountRequired: string;  // Amount in microUSDC
    scheme: string;
    mimeType?: string;
  }>;
}

export interface X402TestResult {
  success: boolean;
  statusCode: number;
  response?: any;
  transactionHash?: string;
  cost?: string;
  network?: string;
  timestamp: number;
}

export interface FacilitatorResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

class PayAIClient {
  private facilitatorUrl = 'https://facilitator.payai.network';
  private discoveryUrl = 'https://facilitator.payai.network/discovery/resources';
  private echoMerchantUrl = 'https://x402.payai.network';

  /**
   * Discover available x402 services via PayAI facilitator
   * The facilitator /discovery/resources endpoint returns ALL registered x402 services in the ecosystem
   * (80+ services including tokens, AI, gaming, social, and more)
   */
  async discoverServices(): Promise<FacilitatorResponse<X402Service[]>> {
    try {
      console.log('🔍 Querying PayAI discovery endpoint for ALL x402 services...');
      console.log(`📡 Endpoint: ${this.discoveryUrl}`);
      
      const response = await fetch(this.discoveryUrl, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Discovery endpoint returned ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      console.log('✅ PayAI Discovery response received');
      console.log('📊 Response structure:', {
        hasItems: !!data.items,
        itemsCount: data.items?.length || 0,
        total: data.pagination?.total || 0,
        x402Version: data.x402Version
      });

      // Parse all services from the items array
      const allServices = this.parseDiscoveryResponse(data);
      
      console.log('\n🎯 === DISCOVERY SUMMARY ===');
      console.log(`📡 Total services discovered: ${allServices.length}`);
      console.log(`✅ By Network:`);
      const networkCounts = this.groupByNetwork(allServices);
      Object.entries(networkCounts).forEach(([network, count]) => {
        console.log(`   - ${network}: ${count}`);
      });
      console.log(`📦 By Category:`);
      const categoryCounts = this.groupByCategory(allServices);
      Object.entries(categoryCounts).forEach(([category, count]) => {
        console.log(`   - ${category}: ${count}`);
      });
      console.log('========================\n');
      
      return {
        success: true,
        data: allServices,
      };
    } catch (error) {
      console.error('❌ Service discovery failed:', error);
      console.warn('⚠️ Falling back to Echo Merchant services only');
      
      // Fallback: at minimum show Echo Merchant
      return {
        success: true,
        data: this.getEchoMerchantServices(),
      };
    }
  }

  /**
   * Test x402 protocol using PayAI's Echo Merchant
   */
  async testEchoMerchant(network: string = 'base-sepolia'): Promise<X402TestResult> {
    const startTime = Date.now();
    
    try {
      // Step 1: Initial request (should return 402)
      const initialResponse = await fetch(`${this.echoMerchantUrl}/api/${network}/paid-content`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (initialResponse.status === 402) {
        // Extract payment information from 402 response
        const paymentInfo = await initialResponse.json();
        
        // For demo purposes, simulate the payment flow
        // In real implementation, this would involve wallet interaction
        console.log('HTTP 402 Payment Required:', paymentInfo);
        
        return {
          success: true,
          statusCode: 402,
          response: paymentInfo,
          timestamp: startTime,
          network,
        };
      }

      // If not 402, something unexpected happened
      const responseData = await initialResponse.json();
      
      return {
        success: initialResponse.ok,
        statusCode: initialResponse.status,
        response: responseData,
        timestamp: startTime,
        network,
      };
    } catch (error) {
      console.error('Echo Merchant test failed:', error);
      return {
        success: false,
        statusCode: 0,
        response: { error: error instanceof Error ? error.message : 'Unknown error' },
        timestamp: startTime,
        network,
      };
    }
  }

  /**
   * Verify a payment via PayAI facilitator
   */
  async verifyPayment(paymentData: any): Promise<FacilitatorResponse<any>> {
    try {
      const response = await fetch(`${this.facilitatorUrl}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(paymentData),
      });

      const data = await response.json();
      
      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || 'Verification failed',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Settle a payment via PayAI facilitator
   */
  async settlePayment(settlementData: any): Promise<FacilitatorResponse<any>> {
    try {
      const response = await fetch(`${this.facilitatorUrl}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settlementData),
      });

      const data = await response.json();
      
      return {
        success: response.ok,
        data: response.ok ? data : undefined,
        error: response.ok ? undefined : data.error || 'Settlement failed',
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Parse the real discovery endpoint response format
   * Endpoint: https://facilitator.payai.network/discovery/resources
   */
  private parseDiscoveryResponse(data: any): X402Service[] {
    if (!data.items || !Array.isArray(data.items)) {
      console.warn('⚠️ No items array in discovery response');
      return [];
    }

    console.log(`🔄 Parsing ${data.items.length} services from discovery endpoint...`);
    
    // Debug: Log first item structure to understand the data format
    if (data.items.length > 0) {
      console.log('📋 Sample item structure:', JSON.stringify(data.items[0], null, 2));
      console.log('📋 Available fields in first item:', Object.keys(data.items[0]));
      if (data.items[0].metadata) {
        console.log('📋 Metadata fields:', Object.keys(data.items[0].metadata));
      }
    }
    
    return data.items
      .map((item: any, index: number) => {
        try {
          const resource = item.resource;
          const accepts = item.accepts?.[0]; // Get first payment option
          
          if (!resource || !accepts) {
            console.warn(`⚠️ Skipping item ${index}: missing resource or accepts`);
            return null;
          }

          // Extract description from metadata or other fields
          let description = item.metadata?.description || 
                           item.metadata?.summary || 
                           item.metadata?.info ||
                           item.description ||
                           '';
          
          // Extract service name from resource URL
          const name = this.extractServiceName(resource, description);
          
          // If no description found, generate a fallback
          if (!description || description.trim().length === 0) {
            description = this.generateFallbackDescription(resource, name);
            console.log(`📝 Generated fallback description for ${name}: ${description.substring(0, 50)}...`);
          }
          
          // Parse amount from microUSDC to USDC
          const maxAmountMicro = parseInt(accepts.maxAmountRequired) || 10000;
          const amountUSDC = (maxAmountMicro / 1_000_000).toFixed(2);
          
          // Determine currency from asset address or network
          const currency = this.determineCurrency(accepts.asset, accepts.network);
          
          // Generate unique ID from resource and index
          const id = this.generateServiceId(resource, index);
          
          // Categorize based on description and resource
          const category = this.categorizeFromContent(resource, description);

          return {
            id,
            name,
            description: description,
            endpoint: resource,
            price: {
              amount: amountUSDC,
              currency: currency as 'USDC' | 'SOL',
              network: accepts.network,
            },
            category,
            status: 'online',
            responseTime: undefined,
            rating: undefined,
            totalCalls: 0,
            lastUpdated: item.lastUpdated,
            accepts: item.accepts, // Include full payment details
          } as X402Service;
        } catch (parseError) {
          console.error(`❌ Failed to parse item ${index}:`, parseError);
          return null;
        }
      })
      .filter((s): s is X402Service => s !== null);
  }

  /**
   * Extract a readable service name from the resource URL
   */
  private extractServiceName(resource: string, description?: string): string {
    try {
      // Try to get from description first
      if (description && description.length > 0 && description.length < 100) {
        // Use description if it's reasonable length
        return description.split('-')[0].trim();
      }

      const url = new URL(resource);
      const hostname = url.hostname;
      const path = url.pathname;
      
      // Extract readable name from hostname
      const domainParts = hostname.replace('www.', '').split('.');
      let name = domainParts[0];
      
      // Capitalize and clean up
      name = name.charAt(0).toUpperCase() + name.slice(1);
      
      // Add path context if meaningful
      if (path && path !== '/' && path !== '/mint' && path !== '/api') {
        const pathPart = path.split('/').filter(p => p && p !== 'api' && p !== 'v1')[0];
        if (pathPart) {
          name += ` ${pathPart.charAt(0).toUpperCase() + pathPart.slice(1)}`;
        }
      }
      
      return name;
    } catch {
      return 'x402 Service';
    }
  }

  /**
   * Generate a fallback description from the resource URL
   */
  private generateFallbackDescription(resource: string, name: string): string {
    try {
      const url = new URL(resource);
      const hostname = url.hostname;
      const path = url.pathname;
      
      // Known services - manual descriptions
      const knownServices: Record<string, string> = {
        'x402.payai.network': 'Free testing service for x402 protocol. Test payment flows without spending real tokens.',
        'baldx402.lol': 'NFT minting service on Base network. Mint unique digital collectibles.',
        'gxfc.world': 'Premium AI content generation service. Create high-quality text and media.',
        'faucetx402': 'Token faucet service. Get testnet tokens for development and testing.',
      };
      
      // Check if it's a known service
      for (const [domain, desc] of Object.entries(knownServices)) {
        if (hostname.includes(domain)) {
          return desc;
        }
      }
      
      // Generate description from URL structure
      if (path.includes('/mint')) {
        return `Minting service on ${hostname}. Create and mint digital assets.`;
      } else if (path.includes('/api')) {
        return `API service providing ${name.toLowerCase()} functionality.`;
      } else if (path.includes('/premium')) {
        return `Premium ${name.toLowerCase()} service with enhanced features.`;
      } else if (hostname.includes('faucet')) {
        return 'Token distribution service for testing and development.';
      }
      
      // Default fallback
      return `x402-enabled service on ${hostname}. Pay per request with instant settlements.`;
    } catch {
      return 'x402-enabled service. Pay per request with instant settlements.';
    }
  }

  /**
   * Generate a unique service ID from resource URL and index
   */
  private generateServiceId(resource: string, index: number): string {
    try {
      const url = new URL(resource);
      const baseId = `${url.hostname}${url.pathname}`.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      // Add index to ensure uniqueness
      return `${baseId}-${index}`;
    } catch {
      return `service-${index}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  /**
   * Determine currency from asset address or network
   */
  private determineCurrency(asset: string, network: string): string {
    // Solana USDC address
    if (asset === 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v') {
      return 'USDC';
    }
    
    // If network is solana but not USDC, probably SOL
    if (network.includes('solana')) {
      return asset.length > 40 ? 'USDC' : 'SOL';
    }
    
    // Default to USDC for EVM chains
    return 'USDC';
  }

  /**
   * Categorize service from content
   */
  private categorizeFromContent(resource: string, description?: string): string {
    const combined = `${resource} ${description || ''}`.toLowerCase();
    
    if (combined.includes('mint') || combined.includes('token') || combined.includes('airdrop')) {
      return 'Tokens';
    }
    if (combined.includes('ai') || combined.includes('chat') || combined.includes('llm') || combined.includes('gpt')) {
      return 'AI';
    }
    if (combined.includes('game') || combined.includes('lottery') || combined.includes('scratcher') || combined.includes('play')) {
      return 'Gaming';
    }
    if (combined.includes('tip') || combined.includes('social') || combined.includes('tweet')) {
      return 'Social';
    }
    if (combined.includes('news') || combined.includes('data') || combined.includes('idea')) {
      return 'Data';
    }
    if (combined.includes('echo') || combined.includes('test') || combined.includes('payai.network')) {
      return 'Development';
    }
    
    return 'Other';
  }

  /**
   * Group services by network for statistics
   */
  private groupByNetwork(services: X402Service[]): Record<string, number> {
    return services.reduce((acc, service) => {
      const network = service.price.network;
      acc[network] = (acc[network] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Group services by category for statistics
   */
  private groupByCategory(services: X402Service[]): Record<string, number> {
    return services.reduce((acc, service) => {
      const category = service.category;
      acc[category] = (acc[category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }

  /**
   * Get known real PayAI services from their GitHub
   * These are removed since we'll discover them via facilitator
   * Only keeping this as a fallback if facilitator is down
   */
  private getKnownPayAIServices(): X402Service[] {
    // Return empty - we'll discover services via facilitator /list
    // This method exists only as documentation of known services
    return [];
  }

  /**
   * Get Echo Merchant test services (FREE, auto-refunded)
   */
  private getEchoMerchantServices(): X402Service[] {
    const networks = ['base', 'base-sepolia', 'solana-mainnet', 'solana-devnet'];
    
    return networks.map(network => ({
      id: `echo-merchant-${network}`,
      name: `Echo Merchant Test (${network})`,
      description: `FREE testing service - payments are auto-refunded. Test x402 protocol on ${network}.`,
      endpoint: `${this.echoMerchantUrl}/api/${network}/paid-content`,
      price: {
        amount: '0.001',
        currency: network.startsWith('solana') ? 'SOL' : 'USDC',
        network: network as any,
      },
      category: 'Development',
      status: 'online',
      responseTime: 150,
      rating: 5.0,
      totalCalls: 0,
    }));
  }

  /**
   * Categorize service based on type or description
   */
  private categorizeService(type: string): X402Service['category'] {
    const lowercaseType = type.toLowerCase();
    
    if (lowercaseType.includes('ai') || lowercaseType.includes('ml') || lowercaseType.includes('gpt')) {
      return 'AI';
    }
    if (lowercaseType.includes('content') || lowercaseType.includes('text') || lowercaseType.includes('writing')) {
      return 'Content';
    }
    if (lowercaseType.includes('code') || lowercaseType.includes('dev') || lowercaseType.includes('api')) {
      return 'Development';
    }
    if (lowercaseType.includes('data') || lowercaseType.includes('analytics') || lowercaseType.includes('analysis')) {
      return 'Data';
    }
    
    return 'Other';
  }

  /**
   * Get supported networks for x402 payments
   */
  getSupportedNetworks() {
    return [
      { id: 'base', name: 'Base Mainnet', testnet: false },
      { id: 'base-sepolia', name: 'Base Sepolia', testnet: true },
      { id: 'solana-mainnet', name: 'Solana Mainnet', testnet: false },
      { id: 'solana-devnet', name: 'Solana Devnet', testnet: true },
    ];
  }
}

// Export singleton instance
export const payaiClient = new PayAIClient();

// Export types
export type { FacilitatorResponse };
