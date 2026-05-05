// Client-side AI response generation based on real stats

export interface AIContext {
  hasData: boolean;
  totalRevenue: number;
  totalEvents: number;
  totalPurchases: number;
  totalClicks: number;
  conversionRate: number;
  uniquePlayers: number;
  revenueByType: { gamepass: number; devproduct: number };
  topProducts: {
    name: string;
    revenue: number;
    purchases: number;
    clicks: number;
    conversionRate: number;
    productType: string;
  }[];
  worstConvertingProduct: {
    name: string;
    clicks: number;
    purchases: number;
    conversionRate: number;
  } | null;
  trends: {
    revenueChange: number;
    purchaseChange: number;
    playerChange: number;
    currentWeekRevenue: number;
    previousWeekRevenue: number;
    currentWeekPurchases: number;
    previousWeekPurchases: number;
    currentWeekPlayers: number;
    previousWeekPlayers: number;
  };
  recentEvents: {
    eventType: string;
    productName: string | null;
    robux: number;
    createdAt: string;
  }[];
  gameName: string | null;
}

// Format trend as a readable string
function formatTrend(change: number): string {
  if (change === 0) return "unchanged";
  const direction = change > 0 ? "increased" : "decreased";
  return `${direction} ${Math.abs(change).toFixed(0)}%`;
}

// Generate business insights from real data
export function generateBusinessInsights(context: AIContext): string[] {
  const insights: string[] = [];
  const { topProducts, worstConvertingProduct, trends, revenueByType, totalRevenue, conversionRate } = context;

  // Best selling product insight
  if (topProducts.length > 0) {
    const best = topProducts[0];
    insights.push(`**${best.name}** is your best seller with **${best.revenue.toLocaleString()} Robux** revenue (${best.purchases} purchases).`);
  }

  // Product comparison insight
  if (topProducts.length >= 2) {
    const best = topProducts[0];
    const second = topProducts[1];
    if (best.conversionRate > 0 && second.conversionRate > 0) {
      const ratio = (best.conversionRate / second.conversionRate).toFixed(1);
      if (parseFloat(ratio) > 1.5) {
        insights.push(`**${best.name}** converts **${ratio}x better** than **${second.name}**.`);
      }
    }
  }

  // Worst converting product insight
  if (worstConvertingProduct && worstConvertingProduct.conversionRate < 5) {
    insights.push(`**${worstConvertingProduct.name}** has the lowest conversion at **${worstConvertingProduct.conversionRate.toFixed(1)}%** (${worstConvertingProduct.clicks} clicks, ${worstConvertingProduct.purchases} purchases). Consider revising its price or value proposition.`);
  }

  // Revenue trend insight
  if (trends.previousWeekRevenue > 0 || trends.currentWeekRevenue > 0) {
    const direction = trends.revenueChange >= 0 ? "increased" : "decreased";
    insights.push(`Revenue ${direction} **${Math.abs(trends.revenueChange).toFixed(0)}%** over 7 days (${trends.currentWeekRevenue.toLocaleString()} vs ${trends.previousWeekRevenue.toLocaleString()} Robux).`);
  }

  // Purchase trend insight
  if (trends.previousWeekPurchases > 0 || trends.currentWeekPurchases > 0) {
    const direction = trends.purchaseChange >= 0 ? "increased" : "decreased";
    insights.push(`Purchases ${direction} **${Math.abs(trends.purchaseChange).toFixed(0)}%** this week (${trends.currentWeekPurchases} vs ${trends.previousWeekPurchases} purchases).`);
  }

  // Player trend insight
  if (trends.previousWeekPlayers > 0 || trends.currentWeekPlayers > 0) {
    const direction = trends.playerChange >= 0 ? "increased" : "decreased";
    insights.push(`Player visits ${direction} **${Math.abs(trends.playerChange).toFixed(0)}%** (${trends.currentWeekPlayers} vs ${trends.previousWeekPlayers} unique players).`);
  }

  // Revenue split insight
  if (totalRevenue > 0) {
    const gamepassPct = Math.round((revenueByType.gamepass / totalRevenue) * 100);
    const devproductPct = Math.round((revenueByType.devproduct / totalRevenue) * 100);
    if (gamepassPct > 80) {
      insights.push(`**${gamepassPct}%** of revenue comes from gamepasses. Consider adding developer products for recurring purchases.`);
    } else if (devproductPct > 80) {
      insights.push(`**${devproductPct}%** of revenue comes from dev products. Consider adding premium gamepasses for higher-value sales.`);
    }
  }

  // Conversion insight
  if (conversionRate < 3) {
    insights.push(`Your overall conversion rate is **${conversionRate.toFixed(1)}%** (below average). Focus on improving product visibility and value messaging.`);
  } else if (conversionRate > 15) {
    insights.push(`Your conversion rate of **${conversionRate.toFixed(1)}%** is excellent! Focus on driving more traffic to maximize revenue.`);
  }

  return insights;
}

// Generate smart response based on real stats
export function generateSmartResponse(question: string, context: AIContext): string {
  const { 
    hasData, 
    totalRevenue, 
    totalEvents, 
    totalPurchases, 
    totalClicks, 
    conversionRate,
    uniquePlayers,
    revenueByType,
    topProducts,
    worstConvertingProduct,
    trends,
    gameName,
  } = context;

  if (!hasData) {
    return "I need tracking data to provide insights.\n\n**To get started:**\n1. Go to the **My Game** page\n2. Copy the Lua tracking script\n3. Install it in your Roblox game\n4. Send events like `session_start`, `gamepass_purchase`, etc.\n\nOnce events flow in, I can analyze your revenue, conversion rates, and give you specific recommendations to increase your Robux earnings.";
  }

  const lowerQuestion = question.toLowerCase();

  // Revenue related questions
  if (lowerQuestion.includes("revenue") || lowerQuestion.includes("robux") || lowerQuestion.includes("earning") || lowerQuestion.includes("money") || lowerQuestion.includes("where") && lowerQuestion.includes("coming from")) {
    const gamepassPct = totalRevenue > 0 ? Math.round((revenueByType.gamepass / totalRevenue) * 100) : 0;
    const devproductPct = totalRevenue > 0 ? Math.round((revenueByType.devproduct / totalRevenue) * 100) : 0;
    
    let response = `**Revenue Analysis**\n\n`;
    response += `Total: **${totalRevenue.toLocaleString()} Robux**\n\n`;
    
    // Revenue breakdown
    response += `**By Type:**\n`;
    response += `- Gamepasses: ${revenueByType.gamepass.toLocaleString()} Robux (${gamepassPct}%)\n`;
    response += `- Dev Products: ${revenueByType.devproduct.toLocaleString()} Robux (${devproductPct}%)\n\n`;
    
    // Trend
    if (trends.previousWeekRevenue > 0 || trends.currentWeekRevenue > 0) {
      response += `**7-Day Trend:** Revenue ${formatTrend(trends.revenueChange)} (${trends.currentWeekRevenue.toLocaleString()} vs ${trends.previousWeekRevenue.toLocaleString()} Robux)\n\n`;
    }
    
    // Top product
    if (topProducts.length > 0) {
      response += `**Top Earner:** ${topProducts[0].name} with ${topProducts[0].revenue.toLocaleString()} Robux`;
    }
    
    return response;
  }

  // Conversion related questions
  if (lowerQuestion.includes("conversion") || lowerQuestion.includes("convert")) {
    let response = `**Conversion Analysis**\n\n`;
    response += `Overall Rate: **${conversionRate.toFixed(1)}%**\n`;
    response += `- Clicks: ${totalClicks.toLocaleString()}\n`;
    response += `- Purchases: ${totalPurchases.toLocaleString()}\n\n`;
    
    // Best converter
    if (topProducts.length > 0) {
      const bestConverter = [...topProducts].filter(p => p.clicks >= 5).sort((a, b) => b.conversionRate - a.conversionRate)[0];
      if (bestConverter) {
        response += `**Best Converting:** ${bestConverter.name} at ${bestConverter.conversionRate.toFixed(1)}%\n`;
      }
    }
    
    // Worst converter
    if (worstConvertingProduct) {
      response += `**Needs Improvement:** ${worstConvertingProduct.name} at ${worstConvertingProduct.conversionRate.toFixed(1)}% (${worstConvertingProduct.clicks} clicks, only ${worstConvertingProduct.purchases} purchases)\n\n`;
      response += `**Recommendation:** ${worstConvertingProduct.name} gets attention but doesn't convert. Try:\n`;
      response += `- Lowering the price\n`;
      response += `- Adding more visible benefits\n`;
      response += `- Creating urgency with limited-time offers`;
    }
    
    return response;
  }

  // Product related questions
  if (lowerQuestion.includes("product") || lowerQuestion.includes("gamepass") || lowerQuestion.includes("best sell") || lowerQuestion.includes("improve")) {
    if (topProducts.length === 0) {
      return "No product sales recorded yet. Send `gamepass_purchase` or `devproduct_purchase` events to track product performance.";
    }
    
    let response = `**Product Performance**\n\n`;
    
    // Best seller
    const best = topProducts[0];
    response += `**Best Seller:** ${best.name}\n`;
    response += `- Revenue: ${best.revenue.toLocaleString()} Robux\n`;
    response += `- Purchases: ${best.purchases}\n`;
    response += `- Conversion: ${best.conversionRate.toFixed(1)}%\n\n`;
    
    // Comparison if multiple products
    if (topProducts.length >= 2) {
      const second = topProducts[1];
      response += `**Runner-up:** ${second.name} (${second.revenue.toLocaleString()} Robux)\n`;
      
      if (best.conversionRate > 0 && second.conversionRate > 0) {
        const ratio = best.conversionRate / second.conversionRate;
        if (ratio > 1.2) {
          response += `\n**${best.name}** converts **${ratio.toFixed(1)}x better** than ${second.name}.\n`;
        }
      }
    }
    
    // Worst performer
    if (worstConvertingProduct && worstConvertingProduct.conversionRate < 5) {
      response += `\n**Needs Attention:** ${worstConvertingProduct.name} has only ${worstConvertingProduct.conversionRate.toFixed(1)}% conversion despite ${worstConvertingProduct.clicks} clicks. Consider revising price or benefits.`;
    }
    
    return response;
  }

  // Stats overview
  if (lowerQuestion.includes("stats") || lowerQuestion.includes("overview") || lowerQuestion.includes("summary") || lowerQuestion.includes("how am i doing")) {
    let response = `**${gameName || "Game"} Performance Overview**\n\n`;
    
    // Key metrics
    response += `**Key Metrics:**\n`;
    response += `- Revenue: ${totalRevenue.toLocaleString()} Robux\n`;
    response += `- Purchases: ${totalPurchases.toLocaleString()}\n`;
    response += `- Unique Players: ${uniquePlayers.toLocaleString()}\n`;
    response += `- Conversion: ${conversionRate.toFixed(1)}%\n\n`;
    
    // Trends
    response += `**7-Day Trends:**\n`;
    response += `- Revenue: ${formatTrend(trends.revenueChange)}\n`;
    response += `- Purchases: ${formatTrend(trends.purchaseChange)}\n`;
    response += `- Players: ${formatTrend(trends.playerChange)}\n\n`;
    
    // Best performer
    if (topProducts.length > 0) {
      response += `**Top Product:** ${topProducts[0].name} (${topProducts[0].revenue.toLocaleString()} Robux)`;
    }
    
    return response;
  }

  // Players related
  if (lowerQuestion.includes("player") || lowerQuestion.includes("user") || lowerQuestion.includes("audience") || lowerQuestion.includes("visit")) {
    const avgRevenuePerPlayer = uniquePlayers > 0 ? Math.round(totalRevenue / uniquePlayers) : 0;
    const purchaseRate = uniquePlayers > 0 ? ((totalPurchases / uniquePlayers) * 100).toFixed(1) : "0";
    
    let response = `**Player Analytics**\n\n`;
    response += `- Unique Players: ${uniquePlayers.toLocaleString()}\n`;
    response += `- Revenue per Player: ${avgRevenuePerPlayer.toLocaleString()} Robux\n`;
    response += `- Purchase Rate: ${purchaseRate}%\n\n`;
    
    // Player trend
    response += `**7-Day Trend:** Player visits ${formatTrend(trends.playerChange)} (${trends.currentWeekPlayers} vs ${trends.previousWeekPlayers})\n\n`;
    
    // Recommendation
    if (parseFloat(purchaseRate) < 5) {
      response += `**Insight:** Less than 5% of players buy. Focus on:\n`;
      response += `- Better product visibility\n`;
      response += `- Lower entry prices\n`;
      response += `- Clear value communication`;
    } else if (parseFloat(purchaseRate) > 15) {
      response += `**Insight:** Great purchase rate! Focus on driving more player traffic.`;
    }
    
    return response;
  }

  // Trend questions
  if (lowerQuestion.includes("trend") || lowerQuestion.includes("week") || lowerQuestion.includes("growth") || lowerQuestion.includes("change")) {
    let response = `**7-Day Trends**\n\n`;
    
    response += `**Revenue:** ${formatTrend(trends.revenueChange)}\n`;
    response += `- This week: ${trends.currentWeekRevenue.toLocaleString()} Robux\n`;
    response += `- Last week: ${trends.previousWeekRevenue.toLocaleString()} Robux\n\n`;
    
    response += `**Purchases:** ${formatTrend(trends.purchaseChange)}\n`;
    response += `- This week: ${trends.currentWeekPurchases}\n`;
    response += `- Last week: ${trends.previousWeekPurchases}\n\n`;
    
    response += `**Players:** ${formatTrend(trends.playerChange)}\n`;
    response += `- This week: ${trends.currentWeekPlayers} unique\n`;
    response += `- Last week: ${trends.previousWeekPlayers} unique`;
    
    return response;
  }

  // Recommendations
  if (lowerQuestion.includes("recommend") || lowerQuestion.includes("suggest") || lowerQuestion.includes("tip") || lowerQuestion.includes("advice") || lowerQuestion.includes("what should")) {
    const insights = generateBusinessInsights(context);
    
    if (insights.length === 0) {
      return "I need more tracking data to provide specific recommendations. Keep sending events and check back soon!";
    }
    
    let response = `**Recommendations for ${gameName || "Your Game"}**\n\n`;
    insights.slice(0, 5).forEach((insight, i) => {
      response += `${i + 1}. ${insight}\n\n`;
    });
    
    return response;
  }

  // Default: show key insights
  const insights = generateBusinessInsights(context);
  
  if (insights.length > 0) {
    let response = `**Key Insights**\n\n`;
    insights.slice(0, 4).forEach(insight => {
      response += `- ${insight}\n`;
    });
    response += `\nAsk about revenue, conversion, products, or trends for more details!`;
    return response;
  }

  return `Based on ${totalEvents.toLocaleString()} events:\n\n` +
    `- Revenue: **${totalRevenue.toLocaleString()} Robux**\n` +
    `- Conversion: **${conversionRate.toFixed(1)}%**\n` +
    `- Players: **${uniquePlayers.toLocaleString()}**\n\n` +
    `Ask about revenue breakdown, conversion tips, product performance, or trends!`;
}
